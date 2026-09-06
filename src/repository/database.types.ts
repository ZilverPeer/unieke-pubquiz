export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: number
        }
        Insert: {
          created_at?: string
          id?: never
        }
        Update: {
          created_at?: string
          id?: never
        }
        Relationships: []
      }
      category_translations: {
        Row: {
          category_id: number
          locale: Database["public"]["Enums"]["locale"]
          name: string
        }
        Insert: {
          category_id: number
          locale: Database["public"]["Enums"]["locale"]
          name: string
        }
        Update: {
          category_id?: number
          locale?: Database["public"]["Enums"]["locale"]
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_translations_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      composition_items: {
        Row: {
          composition_id: string
          id: number
          item_id: string
          position: number
          slot_index: number
        }
        Insert: {
          composition_id: string
          id?: never
          item_id: string
          position: number
          slot_index: number
        }
        Update: {
          composition_id?: string
          id?: never
          item_id?: string
          position?: number
          slot_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "composition_items_composition_id_fkey"
            columns: ["composition_id"]
            isOneToOne: false
            referencedRelation: "compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "composition_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      compositions: {
        Row: {
          billing_email: string
          created_at: string
          id: string
          locale: Database["public"]["Enums"]["locale"]
          quiz_mode: Database["public"]["Enums"]["quiz_mode"]
          requested_difficulty: Database["public"]["Enums"]["requested_difficulty"]
          seed: number
        }
        Insert: {
          billing_email: string
          created_at?: string
          id?: string
          locale: Database["public"]["Enums"]["locale"]
          quiz_mode: Database["public"]["Enums"]["quiz_mode"]
          requested_difficulty: Database["public"]["Enums"]["requested_difficulty"]
          seed: number
        }
        Update: {
          billing_email?: string
          created_at?: string
          id?: string
          locale?: Database["public"]["Enums"]["locale"]
          quiz_mode?: Database["public"]["Enums"]["quiz_mode"]
          requested_difficulty?: Database["public"]["Enums"]["requested_difficulty"]
          seed?: number
        }
        Relationships: []
      }
      item_translations: {
        Row: {
          answer: string | null
          fact: string | null
          item_id: string
          locale: Database["public"]["Enums"]["locale"]
          question: string | null
        }
        Insert: {
          answer?: string | null
          fact?: string | null
          item_id: string
          locale: Database["public"]["Enums"]["locale"]
          question?: string | null
        }
        Update: {
          answer?: string | null
          fact?: string | null
          item_id?: string
          locale?: Database["public"]["Enums"]["locale"]
          question?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_translations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          created_at: string
          difficulty: Database["public"]["Enums"]["difficulty"]
          id: string
          kind: Database["public"]["Enums"]["item_kind"]
          subsubcategory_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          difficulty: Database["public"]["Enums"]["difficulty"]
          id?: string
          kind: Database["public"]["Enums"]["item_kind"]
          subsubcategory_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          difficulty?: Database["public"]["Enums"]["difficulty"]
          id?: string
          kind?: Database["public"]["Enums"]["item_kind"]
          subsubcategory_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_subsubcategory_id_fkey"
            columns: ["subsubcategory_id"]
            isOneToOne: false
            referencedRelation: "subsubcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      music_item_details: {
        Row: {
          artist: string
          item_id: string
          storage_path: string
          title: string
        }
        Insert: {
          artist: string
          item_id: string
          storage_path: string
          title: string
        }
        Update: {
          artist?: string
          item_id?: string
          storage_path?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "music_item_details_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billing_email: string
          created_at: string
          id: string
          raw_payload: Json
          status: string
          updated_at: string
          woo_order_id: number
        }
        Insert: {
          billing_email: string
          created_at?: string
          id?: string
          raw_payload: Json
          status: string
          updated_at?: string
          woo_order_id: number
        }
        Update: {
          billing_email?: string
          created_at?: string
          id?: string
          raw_payload?: Json
          status?: string
          updated_at?: string
          woo_order_id?: number
        }
        Relationships: []
      }
      picture_item_details: {
        Row: {
          item_id: string
          storage_path: string
        }
        Insert: {
          item_id: string
          storage_path: string
        }
        Update: {
          item_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "picture_item_details_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          category_picks: Json
          composition_id: string | null
          created_at: string
          delivered_at: string | null
          download_token: string | null
          failure_reason: string | null
          id: string
          locale: Database["public"]["Enums"]["locale"]
          order_id: string
          quiz_mode: Database["public"]["Enums"]["quiz_mode"]
          requested_difficulty: Database["public"]["Enums"]["requested_difficulty"]
          sequence: number
          status: Database["public"]["Enums"]["quiz_status"]
          updated_at: string
          woo_line_item_id: number
        }
        Insert: {
          category_picks: Json
          composition_id?: string | null
          created_at?: string
          delivered_at?: string | null
          download_token?: string | null
          failure_reason?: string | null
          id?: string
          locale: Database["public"]["Enums"]["locale"]
          order_id: string
          quiz_mode: Database["public"]["Enums"]["quiz_mode"]
          requested_difficulty: Database["public"]["Enums"]["requested_difficulty"]
          sequence: number
          status?: Database["public"]["Enums"]["quiz_status"]
          updated_at?: string
          woo_line_item_id: number
        }
        Update: {
          category_picks?: Json
          composition_id?: string | null
          created_at?: string
          delivered_at?: string | null
          download_token?: string | null
          failure_reason?: string | null
          id?: string
          locale?: Database["public"]["Enums"]["locale"]
          order_id?: string
          quiz_mode?: Database["public"]["Enums"]["quiz_mode"]
          requested_difficulty?: Database["public"]["Enums"]["requested_difficulty"]
          sequence?: number
          status?: Database["public"]["Enums"]["quiz_status"]
          updated_at?: string
          woo_line_item_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_composition_id_fkey"
            columns: ["composition_id"]
            isOneToOne: false
            referencedRelation: "compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      subcategories: {
        Row: {
          category_id: number
          created_at: string
          id: number
        }
        Insert: {
          category_id: number
          created_at?: string
          id?: never
        }
        Update: {
          category_id?: number
          created_at?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      subcategory_translations: {
        Row: {
          locale: Database["public"]["Enums"]["locale"]
          name: string
          subcategory_id: number
        }
        Insert: {
          locale: Database["public"]["Enums"]["locale"]
          name: string
          subcategory_id: number
        }
        Update: {
          locale?: Database["public"]["Enums"]["locale"]
          name?: string
          subcategory_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "subcategory_translations_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      subsubcategories: {
        Row: {
          created_at: string
          id: number
          subcategory_id: number
        }
        Insert: {
          created_at?: string
          id?: never
          subcategory_id: number
        }
        Update: {
          created_at?: string
          id?: never
          subcategory_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "subsubcategories_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      subsubcategory_translations: {
        Row: {
          locale: Database["public"]["Enums"]["locale"]
          name: string
          subsubcategory_id: number
        }
        Insert: {
          locale: Database["public"]["Enums"]["locale"]
          name: string
          subsubcategory_id: number
        }
        Update: {
          locale?: Database["public"]["Enums"]["locale"]
          name?: string
          subsubcategory_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "subsubcategory_translations_subsubcategory_id_fkey"
            columns: ["subsubcategory_id"]
            isOneToOne: false
            referencedRelation: "subsubcategories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      difficulty: "easy" | "medium" | "hard"
      item_kind: "text" | "picture" | "music"
      locale: "nl" | "en"
      quiz_mode: "mixed" | "single_category"
      quiz_status: "pending" | "generating" | "delivered" | "failed"
      requested_difficulty: "easy" | "medium" | "hard" | "mixed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      difficulty: ["easy", "medium", "hard"],
      item_kind: ["text", "picture", "music"],
      locale: ["nl", "en"],
      quiz_mode: ["mixed", "single_category"],
      quiz_status: ["pending", "generating", "delivered", "failed"],
      requested_difficulty: ["easy", "medium", "hard", "mixed"],
    },
  },
} as const

