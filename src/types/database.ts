// Auto-generated Supabase database type stubs
// Run `supabase gen types typescript` to regenerate from live schema

export type Database = {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string
          name: string
          company_name: string | null
          email: string | null
          phone: string | null
          is_gc: boolean
          notes: string | null
          jobber_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['clients']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['clients']['Insert']>
      }
      jobs: {
        Row: {
          id: string
          title: string
          job_number: string | null
          client_id: string
          status: string
          contract_value_cents: number
          burdened_labor_cents: number
          total_hours: number
          gross_margin: number
          notes: string | null
          jobber_id: string | null
          start_date: string | null
          end_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['jobs']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['jobs']['Insert']>
      }
      leads: {
        Row: {
          id: string
          name: string
          email: string | null
          phone: string | null
          company: string | null
          address: string | null
          service_type: string | null
          message: string | null
          status: string
          estimated_value_cents: number | null
          source: string | null
          assigned_to: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['leads']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['leads']['Insert']>
      }
      invoices: {
        Row: {
          id: string
          invoice_number: string
          job_id: string | null
          client_id: string
          amount_cents: number
          balance_cents: number
          status: string
          issue_date: string | null
          due_date: string | null
          paid_date: string | null
          jobber_id: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['invoices']['Row'], 'id' | 'created_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['invoices']['Insert']>
      }
      employees: {
        Row: {
          id: string
          name: string
          role: string
          base_rate_cents: number
          burdened_rate_cents: number
          status: string
          is_driver: boolean
          driver_qualified_at: string | null
          phone: string | null
          email: string | null
          hire_date: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['employees']['Row'], 'id' | 'created_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['employees']['Insert']>
      }
      tasks: {
        Row: {
          id: string
          title: string
          description: string | null
          category: string
          priority: string
          status: string
          assignee: string | null
          due_date: string | null
          job_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['tasks']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['tasks']['Insert']>
      }
      supply_requests: {
        Row: {
          id: string
          item_name: string
          quantity: number
          unit: string | null
          job_id: string | null
          job_name: string | null
          requested_by: string
          priority: string
          status: string
          estimated_cost_cents: number | null
          actual_cost_cents: number | null
          home_depot_url: string | null
          notes: string | null
          telegram_message_id: string | null
          ordered_at: string | null
          received_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['supply_requests']['Row'], 'id' | 'created_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['supply_requests']['Insert']>
      }
      activity_feed: {
        Row: {
          id: string
          event_type: string
          title: string
          description: string | null
          metadata: Record<string, unknown> | null
          job_id: string | null
          client_id: string | null
          lead_id: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['activity_feed']['Row'], 'id' | 'created_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['activity_feed']['Insert']>
      }
      payroll_imports: {
        Row: {
          id: string
          period_start: string
          period_end: string
          total_gross_cents: number
          total_net_cents: number
          total_taxes_cents: number
          employee_count: number
          imported_at: string
          imported_by: string | null
          raw_csv: string | null
        }
        Insert: Omit<Database['public']['Tables']['payroll_imports']['Row'], 'id' | 'imported_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['payroll_imports']['Insert']>
      }
      app_settings: {
        Row: {
          id: string
          key: string
          value: string
          description: string | null
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['app_settings']['Row'], 'id' | 'updated_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['app_settings']['Insert']>
      }
      integration_tokens: {
        Row: {
          id: string
          service: string
          access_token: string
          refresh_token: string | null
          expires_at: string | null
          metadata: Record<string, unknown> | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['integration_tokens']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['integration_tokens']['Insert']>
      }
    }
  }
}
