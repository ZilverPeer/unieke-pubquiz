<?php
/**
 * Plugin Name: Pubquiz Fast Action Scheduler Queue Runner
 * Description: Reschedules Action Scheduler's own queue-runner WP-Cron
 *              event onto a 5-second schedule instead of its default
 *              `every_minute` one.
 *
 * Ticket #58's cron ticker (scripts/shop/lib/cron-ticker.ts) pings
 * wp-cron.php every 5 seconds so WordPress's pseudo-cron -- which only
 * fires on real HTTP traffic -- actually checks for due cron events after
 * a WP-CLI order change. That is not, by itself, enough to deliver the
 * `order.updated` webhook quickly: Action Scheduler's queue runner (the
 * thing that actually processes queued actions, webhook delivery
 * included) is itself a WP-Cron *event*
 * (`ActionScheduler_QueueRunner::WP_CRON_HOOK`,
 * `action_scheduler_run_queue`) scheduled on the `every_minute` schedule
 * (`ActionScheduler_QueueRunner::WP_CRON_SCHEDULE`) -- ticking wp-cron.php
 * more often only makes WordPress *check* for due events sooner, it does
 * not make that event due any sooner. Its other delivery path, an async
 * HTTP loopback request fired at the end of the triggering request
 * (`ActionScheduler_AsyncRequest_QueueRunner`), also cannot fire here,
 * since a WP-CLI order change isn't an HTTP request in the first place.
 *
 * Action Scheduler exposes `action_scheduler_run_schedule`
 * (`ActionScheduler_QueueRunner.php` line 91) for exactly this, but it is
 * only consulted the moment the event is (re)scheduled
 * (`ActionScheduler_QueueRunner::init()`, line 92,
 * `if ( ! wp_next_scheduled( self::WP_CRON_HOOK, $cron_context ) )`) --
 * once scheduled it stays on whatever schedule it was given, so this file
 * also has to actively reschedule the event the first time it finds it on
 * the wrong schedule. `ActionScheduler_QueueRunner::init()` itself runs on
 * `init` priority 1 (`ActionScheduler.php`), so this file's own `init`
 * hook (default priority 10) always runs after it within the same
 * request.
 *
 * The first reschedule is an unlocked WP-Cron read-modify-write against
 * the `cron` option (`wp_unschedule_event()`/`wp_schedule_event()` both
 * read the option, edit it in PHP, then write it back) -- the same window
 * Action Scheduler's own `init()` already has around its `cron` option
 * write, so two concurrent first requests could in principle both read
 * the pre-reschedule state and briefly leave two `action_scheduler_run_queue`
 * events scheduled. Harmless: the queue runner itself is idempotent
 * (running it twice for the same due actions processes each action once,
 * since claiming an action is what actually gates work), and the next
 * request settles back to one event via the `wp_get_schedule()` check
 * above. Once on `pubquiz_every_5s`, every later request pays for exactly
 * one `wp_get_schedule()` read against `cron` -- an autoloaded option, so
 * an in-memory lookup, not a query -- and nothing else.
 *
 * Gated to `wp_get_environment_type()` `local`/`development`, same as
 * `pubquiz-mailpit-smtp.php`: the 5-second schedule only compensates for
 * this *local* setup's two broken delivery paths (a WP-CLI order change
 * generates no real HTTP request for pseudo-cron to run on at all, and the
 * ticker container's requests can't carry Action Scheduler's own async
 * loopback request back out to a real webserver) -- a real deployment has
 * a working async runner (`ActionScheduler_AsyncRequest_QueueRunner`) that
 * already delivers within the same request cycle, so forcing every
 * production page load onto a 5-second WP-Cron schedule would be pure
 * overhead for no benefit there.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

if ( ! in_array( wp_get_environment_type(), array( 'local', 'development' ), true ) ) {
    return;
}

add_filter(
    'cron_schedules', // phpcs:ignore WordPress.WP.CronInterval.CronSchedulesInterval
    function ( $schedules ) {
        $schedules['pubquiz_every_5s'] = array(
            'interval' => 5,
            'display'  => __( 'Every 5 seconds (Pubquiz local cron ticker)', 'pubquiz' ),
        );
        return $schedules;
    }
);

add_filter(
    'action_scheduler_run_schedule',
    function () {
        return 'pubquiz_every_5s';
    }
);

add_action(
    'init',
    function () {
        if ( ! class_exists( 'ActionScheduler_QueueRunner' ) ) {
            return;
        }

        $hook         = ActionScheduler_QueueRunner::WP_CRON_HOOK;
        $cron_context = array( 'WP Cron' ); // Same args ActionScheduler_QueueRunner::init() schedules with.

        // Once the event is confirmed on the fast schedule, every later
        // request does nothing beyond this one in-memory read of the
        // autoloaded `cron` option.
        if ( 'pubquiz_every_5s' === wp_get_schedule( $hook, $cron_context ) ) {
            return;
        }

        $timestamp = wp_next_scheduled( $hook, $cron_context );
        if ( $timestamp ) {
            wp_unschedule_event( $timestamp, $hook, $cron_context );
        }

        wp_schedule_event( time(), 'pubquiz_every_5s', $hook, $cron_context );
    },
    10
);
