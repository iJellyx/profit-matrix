import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "⚠️ Supabase credentials missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env or Vercel env vars."
  );
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

/* ── ROLE HIERARCHY ────────────────────────────────────────────────────── */
export const ROLES = {
  admin:      { level: 100, label: "Admin" },
  manager:    { level: 75,  label: "Manager" },
  strategist: { level: 50,  label: "Strategist" },
  viewer:     { level: 25,  label: "Viewer" },
};

export function hasAccess(userRole, requiredRole) {
  return (ROLES[userRole]?.level ?? 0) >= (ROLES[requiredRole]?.level ?? 999);
}

/* ── PROFILE HELPERS ───────────────────────────────────────────────────── */
export async function getProfile(userId) {
  if (!supabase) return null;
  // Debug: check that we have an active session with a valid JWT
  const { data: { session } } = await supabase.auth.getSession();
  console.log("getProfile — session uid:", session?.user?.id, "requested uid:", userId, "has token:", !!session?.access_token);
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) console.error("getProfile error:", error.message, error.code, error.details);
  console.log("getProfile — result:", data);
  return data;
}

export async function upsertProfile(userId, email, name) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      email,
      name: name || email.split("@")[0],
      role: "viewer",       // default role — admin upgrades later
      status: "pending",    // must be approved by admin
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" })
    .select()
    .single();
  return data;
}

export async function listPendingUsers() {
  if (!supabase) return [];
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  return data || [];
}

export async function listAllUsers() {
  if (!supabase) return [];
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  return data || [];
}

export async function approveUser(userId, role, approvedBy) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("profiles")
    .update({ status: "approved", role, approved_by: approvedBy, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select()
    .single();
  return data;
}

export async function rejectUser(userId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("profiles")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select()
    .single();
  return data;
}

export async function updateUserRole(userId, role) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select()
    .single();
  return data;
}
