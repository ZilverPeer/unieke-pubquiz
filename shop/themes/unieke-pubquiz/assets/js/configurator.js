/**
 * Unieke Pubquiz child theme -- configurator controls (ticket #146).
 *
 * Progressive enhancement only. Taal (`locale`) and Moeilijkheid
 * (`difficulty`) are real `<select>` fields printed by the product-fields
 * plugin (`setup-field-group.php`; kept as `<select>`, not radios -- the
 * ticket brief's "Decisions" resolves the spec's "radios" wording against
 * that fixed field-group shape by building the toggle/segmented look here
 * instead). This script finds each select inside `#samenstellen`, builds a
 * `role="radiogroup"` of `role="radio"` buttons mirroring its `<option>`s
 * in order, and visually hides the select (`.pubquiz-enhanced`, see
 * `landing.css` -- a clip-rect pattern, not `display:none`) while leaving
 * it in the DOM: it still carries the real value and still posts with the
 * form. A click or Space/Enter on a button sets `select.value` and
 * dispatches a bubbling `change` event (so the product-fields plugin's own
 * listeners, e.g. its live price total, still run); the arrow keys move
 * the checked option the way native radios do, with the usual roving
 * `tabindex` (only the checked button is in the Tab order).
 *
 * No dependency, no bundler: enqueued directly by
 * `woocommerce/archive-product.php` next to `landing.css`. Without
 * JavaScript nothing here runs and the plain `<select>` elements render
 * and post exactly as they did before this ticket.
 */
( function () {
	'use strict';

	/**
	 * @param {HTMLSelectElement} select
	 * @param {string} groupClass
	 * @param {string} optionClass
	 */
	function enhanceSelect( select, groupClass, optionClass ) {
		var container = select.closest( '.wapf-field-container' );
		var fieldId = select.getAttribute( 'data-field-id' ) || '';
		var labelEl = container ? container.querySelector( '.wapf-field-label label' ) : null;

		if ( labelEl && ! labelEl.id ) {
			labelEl.id = 'pubquiz-field-label-' + fieldId;
		}

		var group = document.createElement( 'div' );
		group.className = 'pubquiz-control ' + groupClass;
		group.setAttribute( 'role', 'radiogroup' );
		if ( labelEl ) {
			group.setAttribute( 'aria-labelledby', labelEl.id );
		}

		var buttons = Array.prototype.map.call( select.options, function ( option ) {
			var button = document.createElement( 'button' );
			button.type = 'button';
			button.className = optionClass;
			button.setAttribute( 'role', 'radio' );
			button.setAttribute( 'data-value', option.value );
			button.setAttribute( 'aria-checked', option.selected ? 'true' : 'false' );
			button.tabIndex = option.selected ? 0 : -1;
			button.textContent = option.textContent;
			group.appendChild( button );
			return button;
		} );

		/**
		 * @param {string} value
		 * @param {boolean} focusButton
		 */
		function setChecked( value, focusButton ) {
			var target = null;
			buttons.forEach( function ( button ) {
				var isMatch = button.getAttribute( 'data-value' ) === value;
				button.setAttribute( 'aria-checked', isMatch ? 'true' : 'false' );
				button.tabIndex = isMatch ? 0 : -1;
				if ( isMatch ) {
					target = button;
				}
			} );

			if ( select.value !== value ) {
				select.value = value;
				select.dispatchEvent( new Event( 'change', { bubbles: true } ) );
			}

			if ( focusButton && target ) {
				target.focus();
			}
		}

		buttons.forEach( function ( button, index ) {
			button.addEventListener( 'click', function () {
				setChecked( button.getAttribute( 'data-value' ), false );
			} );

			button.addEventListener( 'keydown', function ( event ) {
				var delta = 0;
				if ( event.key === 'ArrowRight' || event.key === 'ArrowDown' ) {
					delta = 1;
				} else if ( event.key === 'ArrowLeft' || event.key === 'ArrowUp' ) {
					delta = -1;
				} else if ( event.key === ' ' || event.key === 'Enter' ) {
					event.preventDefault();
					setChecked( button.getAttribute( 'data-value' ), false );
					return;
				} else {
					return;
				}

				event.preventDefault();
				var nextIndex = ( index + delta + buttons.length ) % buttons.length;
				setChecked( buttons[ nextIndex ].getAttribute( 'data-value' ), true );
			} );
		} );

		select.classList.add( 'pubquiz-enhanced' );
		select.parentNode.insertBefore( group, select.nextSibling );
	}

	function init() {
		var scope = document.getElementById( 'samenstellen' );
		if ( ! scope ) {
			return;
		}

		var localeSelect = scope.querySelector( 'select[name="wapf[field_locale]"]' );
		var difficultySelect = scope.querySelector( 'select[name="wapf[field_difficulty]"]' );

		if ( localeSelect ) {
			enhanceSelect( localeSelect, 'pubquiz-toggle', 'pubquiz-toggle-option' );
		}
		if ( difficultySelect ) {
			enhanceSelect( difficultySelect, 'pubquiz-segmented', 'pubquiz-segmented-option' );
		}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();
