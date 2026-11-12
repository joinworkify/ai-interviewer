// Hand-written to match supabase/migrations/20261109000000_create_interviews.sql
// followed by 20261109000001_diagram_schema.sql and
// 20261109000002_ai_backend.sql.
// Regenerate with `supabase gen types typescript --local > types/database.ts`
// once the Supabase CLI is available.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string | null;
          email: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          name?: string | null;
          email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string | null;
          email?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      interviews: {
        Row: {
          id: string;
          user_id: string;
          questions: string[];
          duration_minutes: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          questions?: string[];
          duration_minutes?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          questions?: string[];
          duration_minutes?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interviews_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      interview_sessions: {
        Row: {
          id: string;
          interview_id: string;
          user_id: string;
          status: "in_progress" | "completed" | "abandoned";
          vapi_call_id: string | null;
          started_at: string;
          ended_at: string | null;
          transcript: Json | null;
          recording_url: string | null;
          transcript_source: string | null;
          duration_seconds: number | null;
          ended_reason: string | null;
        };
        Insert: {
          id?: string;
          interview_id: string;
          user_id: string;
          status?: "in_progress" | "completed" | "abandoned";
          vapi_call_id?: string | null;
          started_at?: string;
          ended_at?: string | null;
          transcript?: Json | null;
          recording_url?: string | null;
          transcript_source?: string | null;
          duration_seconds?: number | null;
          ended_reason?: string | null;
        };
        Update: {
          id?: string;
          interview_id?: string;
          user_id?: string;
          status?: "in_progress" | "completed" | "abandoned";
          vapi_call_id?: string | null;
          started_at?: string;
          ended_at?: string | null;
          transcript?: Json | null;
          recording_url?: string | null;
          transcript_source?: string | null;
          duration_seconds?: number | null;
          ended_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "interview_sessions_interview_id_fkey";
            columns: ["interview_id"];
            isOneToOne: false;
            referencedRelation: "interviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interview_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      feedback: {
        Row: {
          id: string;
          session_id: string;
          user_id: string;
          total_score: number | null;
          strengths: string[];
          areas_for_improvement: string[];
          final_assessment: string | null;
          per_answer: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id: string;
          total_score?: number | null;
          strengths?: string[];
          areas_for_improvement?: string[];
          final_assessment?: string | null;
          per_answer?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          user_id?: string;
          total_score?: number | null;
          strengths?: string[];
          areas_for_improvement?: string[];
          final_assessment?: string | null;
          per_answer?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "interview_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedback_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      vapi_events: {
        Row: {
          id: string;
          vapi_call_id: string | null;
          type: string;
          payload: Json;
          received_at: string;
        };
        Insert: {
          id?: string;
          vapi_call_id?: string | null;
          type: string;
          payload: Json;
          received_at?: string;
        };
        Update: {
          id?: string;
          vapi_call_id?: string | null;
          type?: string;
          payload?: Json;
          received_at?: string;
        };
        Relationships: [];
      };
      capability_uses: {
        Row: {
          generation_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          generation_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          generation_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capability_uses_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_usage: {
        Row: {
          id: string;
          user_id: string;
          feature: string;
          model: string;
          prompt_tokens: number | null;
          completion_tokens: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          feature: string;
          model: string;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          feature?: string;
          model?: string;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_usage_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      save_generated_interview: {
        Args: {
          p_generation_id: string;
          p_user_id: string;
          p_questions: string[];
        };
        Returns: string;
      };
      store_session_transcript: {
        Args: {
          p_session_id: string;
          p_user_id: string;
          p_transcript: Json;
          p_source: string;
          p_duration_seconds: number;
          p_ended_reason: string;
          p_ended_at: string;
        };
        Returns: { id: string; status: string }[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
