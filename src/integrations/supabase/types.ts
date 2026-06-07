export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_coverage: {
        Row: {
          backend_fn: string | null
          code: string
          dangerous: boolean
          http_method: string
          last_error: string | null
          live_result: Json | null
          live_test_status: string
          mock_supported: boolean
          mock_test_status: string
          module: string
          name: string
          params: string | null
          path: string
          proof: Json | null
          seq: number
          ui_page: string | null
          updated_at: string
          validation: string | null
        }
        Insert: {
          backend_fn?: string | null
          code: string
          dangerous?: boolean
          http_method: string
          last_error?: string | null
          live_result?: Json | null
          live_test_status?: string
          mock_supported?: boolean
          mock_test_status?: string
          module: string
          name: string
          params?: string | null
          path: string
          proof?: Json | null
          seq?: number
          ui_page?: string | null
          updated_at?: string
          validation?: string | null
        }
        Update: {
          backend_fn?: string | null
          code?: string
          dangerous?: boolean
          http_method?: string
          last_error?: string | null
          live_result?: Json | null
          live_test_status?: string
          mock_supported?: boolean
          mock_test_status?: string
          module?: string
          name?: string
          params?: string | null
          path?: string
          proof?: Json | null
          seq?: number
          ui_page?: string | null
          updated_at?: string
          validation?: string | null
        }
        Relationships: []
      }
      api_logs: {
        Row: {
          created_at: string
          endpoint: string | null
          error: string | null
          id: string
          method: string | null
          request: Json | null
          response: Json | null
          service: string | null
          status_code: number | null
        }
        Insert: {
          created_at?: string
          endpoint?: string | null
          error?: string | null
          id?: string
          method?: string | null
          request?: Json | null
          response?: Json | null
          service?: string | null
          status_code?: number | null
        }
        Update: {
          created_at?: string
          endpoint?: string | null
          error?: string | null
          id?: string
          method?: string | null
          request?: Json | null
          response?: Json | null
          service?: string | null
          status_code?: number | null
        }
        Relationships: []
      }
      apifox_orders: {
        Row: {
          created_at: string
          id: string
          rental_session_id: string | null
          request: Json | null
          response: Json | null
          status: string | null
          trade_no: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          rental_session_id?: string | null
          request?: Json | null
          response?: Json | null
          status?: string | null
          trade_no?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          rental_session_id?: string | null
          request?: Json | null
          response?: Json | null
          status?: string | null
          trade_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apifox_orders_rental_session_id_fkey"
            columns: ["rental_session_id"]
            isOneToOne: false
            referencedRelation: "rental_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      batteries: {
        Row: {
          battery_id: string
          id: string
          power_level: number | null
          raw_data: Json | null
          slot_num: number | null
          station_id: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          battery_id: string
          id?: string
          power_level?: number | null
          raw_data?: Json | null
          slot_num?: number | null
          station_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          battery_id?: string
          id?: string
          power_level?: number | null
          raw_data?: Json | null
          slot_num?: number | null
          station_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cabinet_events: {
        Row: {
          event_type: string | null
          id: string
          payload: Json | null
          received_at: string
          severity: string | null
          station_id: string | null
        }
        Insert: {
          event_type?: string | null
          id?: string
          payload?: Json | null
          received_at?: string
          severity?: string | null
          station_id?: string | null
        }
        Update: {
          event_type?: string | null
          id?: string
          payload?: Json | null
          received_at?: string
          severity?: string | null
          station_id?: string | null
        }
        Relationships: []
      }
      kiosk_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: []
      }
      maintenance_actions: {
        Row: {
          action_type: string | null
          created_at: string
          id: string
          params: Json | null
          performed_by: string | null
          result: Json | null
          station_id: string | null
        }
        Insert: {
          action_type?: string | null
          created_at?: string
          id?: string
          params?: Json | null
          performed_by?: string | null
          result?: Json | null
          station_id?: string | null
        }
        Update: {
          action_type?: string | null
          created_at?: string
          id?: string
          params?: Json | null
          performed_by?: string | null
          result?: Json | null
          station_id?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          id: string
          payment_method: string | null
          provider: string | null
          raw_webhook: Json | null
          refund_id: string | null
          refunded_at: string | null
          rental_session_id: string | null
          status: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          payment_method?: string | null
          provider?: string | null
          raw_webhook?: Json | null
          refund_id?: string | null
          refunded_at?: string | null
          rental_session_id?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          payment_method?: string | null
          provider?: string | null
          raw_webhook?: Json | null
          refund_id?: string | null
          refunded_at?: string | null
          rental_session_id?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_rental_session_id_fkey"
            columns: ["rental_session_id"]
            isOneToOne: false
            referencedRelation: "rental_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      price_profiles: {
        Row: {
          active: boolean
          amount: number
          chargenow_price_id: string | null
          created_at: string
          currency: string | null
          id: string
          is_default: boolean | null
          name: string
          period_label: string | null
          shop_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount?: number
          chargenow_price_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          period_label?: string | null
          shop_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number
          chargenow_price_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          period_label?: string | null
          shop_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rental_sessions: {
        Row: {
          amount: number | null
          amount_expected: number | null
          amount_paid: number | null
          apifox_trade_no: string | null
          cabinet_id: string | null
          cancelled_at: string | null
          chargenow_order_id: string | null
          chargenow_status: string | null
          checkout_url: string | null
          checkout_url_expires_at: string | null
          closed_at: string | null
          completed_at: string | null
          created_at: string
          currency: string | null
          customer_language: string | null
          ejected_at: string | null
          error_code: string | null
          error_message: string | null
          failure_code: string | null
          failure_message: string | null
          id: string
          paid_at: string | null
          price_profile_id: string | null
          public_session_code: string | null
          retry_count: number
          returned_at: string | null
          selected_slot_num: number | null
          shop_id: string | null
          started_at: string | null
          state: string
          station_id: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          stripe_payment_method_type: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          amount_expected?: number | null
          amount_paid?: number | null
          apifox_trade_no?: string | null
          cabinet_id?: string | null
          cancelled_at?: string | null
          chargenow_order_id?: string | null
          chargenow_status?: string | null
          checkout_url?: string | null
          checkout_url_expires_at?: string | null
          closed_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string | null
          customer_language?: string | null
          ejected_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          paid_at?: string | null
          price_profile_id?: string | null
          public_session_code?: string | null
          retry_count?: number
          returned_at?: string | null
          selected_slot_num?: number | null
          shop_id?: string | null
          started_at?: string | null
          state?: string
          station_id: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payment_method_type?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          amount_expected?: number | null
          amount_paid?: number | null
          apifox_trade_no?: string | null
          cabinet_id?: string | null
          cancelled_at?: string | null
          chargenow_order_id?: string | null
          chargenow_status?: string | null
          checkout_url?: string | null
          checkout_url_expires_at?: string | null
          closed_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string | null
          customer_language?: string | null
          ejected_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          paid_at?: string | null
          price_profile_id?: string | null
          public_session_code?: string | null
          retry_count?: number
          returned_at?: string | null
          selected_slot_num?: number | null
          shop_id?: string | null
          started_at?: string | null
          state?: string
          station_id?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payment_method_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_sessions_price_profile_id_fkey"
            columns: ["price_profile_id"]
            isOneToOne: false
            referencedRelation: "price_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      slots: {
        Row: {
          battery_id: string | null
          id: string
          raw_data: Json | null
          slot_num: number
          station_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          battery_id?: string | null
          id?: string
          raw_data?: Json | null
          slot_num: number
          station_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          battery_id?: string | null
          id?: string
          raw_data?: Json | null
          slot_num?: number
          station_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stations: {
        Row: {
          cabinet_id: string | null
          created_at: string
          currency: string | null
          id: string
          last_sync_at: string | null
          location_name: string | null
          name: string
          online: boolean | null
          price_per_period: number | null
          raw_data: Json | null
          rentable_count: number | null
          returnable_count: number | null
          shop_id: string | null
          signal: number | null
          station_id: string
          status: string | null
          total_count: number | null
          updated_at: string
        }
        Insert: {
          cabinet_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          last_sync_at?: string | null
          location_name?: string | null
          name: string
          online?: boolean | null
          price_per_period?: number | null
          raw_data?: Json | null
          rentable_count?: number | null
          returnable_count?: number | null
          shop_id?: string | null
          signal?: number | null
          station_id: string
          status?: string | null
          total_count?: number | null
          updated_at?: string
        }
        Update: {
          cabinet_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          last_sync_at?: string | null
          location_name?: string | null
          name?: string
          online?: boolean | null
          price_per_period?: number | null
          raw_data?: Json | null
          rentable_count?: number | null
          returnable_count?: number | null
          shop_id?: string | null
          signal?: number | null
          station_id?: string
          status?: string | null
          total_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          event_type: string | null
          external_id: string | null
          id: string
          payload: Json | null
          processed: boolean | null
          provider: string | null
        }
        Insert: {
          created_at?: string
          event_type?: string | null
          external_id?: string | null
          id?: string
          payload?: Json | null
          processed?: boolean | null
          provider?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string | null
          external_id?: string | null
          id?: string
          payload?: Json | null
          processed?: boolean | null
          provider?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "staff"
        | "user"
        | "viewer"
        | "operator"
        | "super_admin"
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
  public: {
    Enums: {
      app_role: ["admin", "staff", "user", "viewer", "operator", "super_admin"],
    },
  },
} as const
