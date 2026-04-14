import { useState, useEffect } from "react";
import { supabase, getProfile, ROLES, hasAccess, listPendingUsers, listAllUsers, approveUser, rejectUser, updateUserRole } from "./supabase.js";

/* ── SIGN IN / SIGN UP ─────────────────────────────────────────────────── */
export function AuthGate({ T, theme, children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // If Supabase isn't configured, fall back to mock auth
  if (!supabase) return <MockAuthFallback T={T} theme={theme}>{children}</MockAuthFallback>;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) loadProfile(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) loadProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (uid) => {
    setLoading(true);
    const p = await getProfile(uid);
    setProfile(p);
    setLoading(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  if (loading || session === undefined) return <LoadingScreen T={T} />;
  if (!session) return <AuthScreen T={T} theme={theme} />;
  if (!profile || profile.status === "pending") return <PendingScreen T={T} theme={theme} email={session.user.email} signOut={signOut} />;
  if (profile.status === "rejected") return <RejectedScreen T={T} theme={theme} email={session.user.email} signOut={signOut} />;

  // Approved — render the app with user context
  return children({ user: profile, signOut });
}

function LoadingScreen({ T }) {
  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 14, color: T.muted, fontFamily: "var(--h)" }}>Loading...</div>
    </div>
  );
}

function AuthScreen({ T, theme }) {
  const isDark = theme === "dark";
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name: name || email.split("@")[0] } }
        });
        if (error) throw error;
        setMessage("Account created. Check your email to confirm, then wait for admin approval.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) setError(error.message);
  };

  const inputStyle = {
    width: "100%", padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`,
    background: T.inputBg, color: T.textStrong, fontSize: 14, fontWeight: 600, outline: "none", fontFamily: "var(--h)"
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "var(--h)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 400, maxWidth: "100%", padding: "30px 28px", borderRadius: 14, background: T.panel, border: `1.5px solid ${T.border}`, boxShadow: "0 14px 60px rgba(0,0,0,0.4)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 22 }}>
          <img src="/social-enviro-logo.png" alt="SE" onError={e => { e.currentTarget.style.display = "none"; }}
            style={{ height: 36, filter: isDark ? "invert(1) brightness(1.1)" : "none" }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.textStrong }}>Social Enviro</div>
            <div style={{ fontSize: 11.5, color: T.muted, fontFamily: "var(--m)", letterSpacing: "0.04em" }}>COMMAND OS</div>
          </div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, padding: 3, background: T.card, border: `1.5px solid ${T.border}`, borderRadius: 8 }}>
          <button onClick={() => setMode("signin")} style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: mode === "signin" ? T.panel : "transparent", color: mode === "signin" ? T.textStrong : T.muted, fontFamily: "var(--h)" }}>Sign In</button>
          <button onClick={() => setMode("signup")} style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: mode === "signup" ? T.panel : "transparent", color: mode === "signup" ? T.textStrong : T.muted, fontFamily: "var(--h)" }}>Sign Up</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.label, marginBottom: 5 }}>Full name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={inputStyle} />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.label, marginBottom: 5 }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required style={inputStyle} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.label, marginBottom: 5 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} style={inputStyle} />
          </div>

          {error && <div style={{ padding: "9px 12px", borderRadius: 7, background: "rgba(200,60,60,0.12)", border: "1.5px solid rgba(200,60,60,0.3)", color: T.red, fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>{error}</div>}
          {message && <div style={{ padding: "9px 12px", borderRadius: 7, background: "rgba(120,220,160,0.12)", border: "1.5px solid rgba(120,220,160,0.3)", color: T.green, fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>{message}</div>}

          <button type="submit" disabled={submitting}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 8, border: `1.5px solid ${T.green}`, background: T.green, color: isDark ? "#0c0e16" : "#ffffff", fontSize: 14, fontWeight: 800, cursor: submitting ? "wait" : "pointer", fontFamily: "var(--h)", marginBottom: 10 }}>
            {submitting ? "..." : mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}>
          <div style={{ flex: 1, height: 1, background: T.border }} />
          <span style={{ fontSize: 11, color: T.muted }}>or</span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>

        <button onClick={handleGoogleSignIn}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.card, color: T.textStrong, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>G</span> Continue with Google
        </button>

        {mode === "signup" && (
          <p style={{ fontSize: 11.5, color: T.muted, margin: "14px 0 0", lineHeight: 1.5, textAlign: "center" }}>
            After sign-up, your account requires <b style={{ color: T.text }}>admin approval</b> before you can access the platform.
          </p>
        )}
      </div>
    </div>
  );
}

function PendingScreen({ T, theme, email, signOut }) {
  const isDark = theme === "dark";
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "var(--h)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 420, maxWidth: "100%", padding: "30px 28px", borderRadius: 14, background: T.panel, border: `1.5px solid ${T.border}`, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
        <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 800, color: T.textStrong }}>Pending Approval</h2>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: T.text, lineHeight: 1.6 }}>
          Your account (<b>{email}</b>) has been created. An administrator needs to approve it before you can access the platform.
        </p>
        <p style={{ margin: "0 0 20px", fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>
          You'll get access as soon as they approve. Refresh this page to check.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button onClick={() => window.location.reload()} style={{ padding: "9px 16px", borderRadius: 7, border: `1.5px solid ${T.green}`, background: "rgba(120,220,160,0.14)", color: T.green, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>Refresh</button>
          <button onClick={signOut} style={{ padding: "9px 16px", borderRadius: 7, border: `1.5px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

function RejectedScreen({ T, theme, email, signOut }) {
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "var(--h)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 420, maxWidth: "100%", padding: "30px 28px", borderRadius: 14, background: T.panel, border: `1.5px solid ${T.border}`, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🚫</div>
        <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 800, color: T.textStrong }}>Access Denied</h2>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: T.text, lineHeight: 1.6 }}>
          Your account (<b>{email}</b>) was not approved. Contact an administrator if you think this is an error.
        </p>
        <button onClick={signOut} style={{ padding: "9px 16px", borderRadius: 7, border: `1.5px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>Sign out</button>
      </div>
    </div>
  );
}

/* ── MOCK FALLBACK (when Supabase isn't configured) ────────────────────── */
function MockAuthFallback({ T, theme, children }) {
  // Import TEAM from parent — passed as props won't work since this is in a separate file.
  // We'll use localStorage to simulate sign-in like before.
  const [userId, setUserId] = useState(() => {
    try { return localStorage.getItem("se.user") || null; } catch { return null; }
  });

  const mockUser = userId ? {
    id: userId,
    name: userId === "u_dylan" ? "Dylan Anderson" : userId === "u_james" ? "James Kelly" : "Team Member",
    email: `${userId}@socialenviro.ie`,
    role: userId === "u_dylan" ? "admin" : "manager",
    status: "approved",
  } : null;

  const signOut = () => { setUserId(null); localStorage.removeItem("se.user"); };

  if (!mockUser) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "var(--h)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ width: 380, padding: "30px 28px", borderRadius: 14, background: T.panel, border: `1.5px solid ${T.border}`, boxShadow: "0 14px 60px rgba(0,0,0,0.4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
            <img src="/social-enviro-logo.png" alt="SE" onError={e => { e.currentTarget.style.display = "none"; }} style={{ height: 36, filter: theme === "dark" ? "invert(1) brightness(1.1)" : "none" }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.textStrong }}>Social Enviro</div>
              <div style={{ fontSize: 11.5, color: T.muted, fontFamily: "var(--m)" }}>COMMAND OS</div>
            </div>
          </div>
          <p style={{ fontSize: 12.5, color: T.muted, margin: "0 0 14px", lineHeight: 1.5 }}>
            <b style={{ color: T.amber }}>DEMO MODE</b> — Supabase not configured. Pick a user to impersonate.
          </p>
          {[
            { id: "u_dylan", label: "Dylan Anderson — Admin" },
            { id: "u_james", label: "James Kelly — Manager" },
            { id: "u_aoife", label: "Aoife Murphy — Strategist" },
          ].map(u => (
            <button key={u.id} onClick={() => { setUserId(u.id); localStorage.setItem("se.user", u.id); }}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 7, border: `1.5px solid ${T.border}`, background: T.card, color: T.textStrong, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)", textAlign: "left", marginBottom: 6 }}>
              {u.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return children({ user: mockUser, signOut });
}

/* ── ADMIN: USER MANAGEMENT ────────────────────────────────────────────── */
export function TeamManagement({ T, currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadUsers(); }, []);
  const loadUsers = async () => {
    setLoading(true);
    const all = await listAllUsers();
    setUsers(all);
    setLoading(false);
  };

  const handleApprove = async (uid, role) => {
    await approveUser(uid, role, currentUser.id);
    loadUsers();
  };

  const handleReject = async (uid) => {
    if (!confirm("Reject this user? They won't be able to access the platform.")) return;
    await rejectUser(uid);
    loadUsers();
  };

  const handleRoleChange = async (uid, role) => {
    await updateUserRole(uid, role);
    loadUsers();
  };

  const isAdmin = hasAccess(currentUser.role, "admin");
  if (!isAdmin) {
    return (
      <div style={{ padding: "60px 28px", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.textStrong }}>Admin access required</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>Only admins can manage team members.</div>
      </div>
    );
  }

  const pending = users.filter(u => u.status === "pending");
  const approved = users.filter(u => u.status === "approved");
  const rejected = users.filter(u => u.status === "rejected");

  const selectStyle = { padding: "5px 8px", borderRadius: 6, border: `1.5px solid ${T.border}`, background: T.card, color: T.textStrong, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--h)" };

  return (
    <div>
      <div style={{ padding: "20px 28px 16px", borderBottom: `1.5px solid ${T.border}` }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.textStrong, display: "flex", alignItems: "center", gap: 9 }}>
          <span>👥</span> Team Management
        </h1>
        <p style={{ margin: "5px 0 0", fontSize: 13.5, color: T.muted }}>Approve new sign-ups, manage roles, and control access.</p>
      </div>

      <div style={{ padding: "16px 28px" }}>
        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: T.muted }}>Loading team...</div>
        ) : (
          <>
            {/* Pending approvals */}
            {pending.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800, color: T.amber, display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.amber }} />
                  Pending approval ({pending.length})
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pending.map(u => (
                    <div key={u.id} style={{ padding: "13px 16px", borderRadius: 9, background: T.panel, border: `1.5px solid ${T.amber}40`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.textStrong }}>{u.name}</div>
                        <div style={{ fontSize: 12, color: T.muted, fontFamily: "var(--m)" }}>{u.email}</div>
                        <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Signed up {new Date(u.created_at).toLocaleDateString()}</div>
                      </div>
                      <select defaultValue="viewer" id={`role-${u.id}`} style={selectStyle}>
                        {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <button onClick={() => handleApprove(u.id, document.getElementById(`role-${u.id}`).value)}
                        style={{ padding: "7px 14px", borderRadius: 7, border: `1.5px solid ${T.green}`, background: T.green, color: "#0c0e16", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--h)" }}>
                        ✓ Approve
                      </button>
                      <button onClick={() => handleReject(u.id)}
                        style={{ padding: "7px 14px", borderRadius: 7, border: `1.5px solid ${T.red}`, background: "rgba(200,60,60,0.15)", color: T.red, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>
                        ✕ Reject
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active team */}
            <div style={{ marginBottom: 22 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800, color: T.green, display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.green }} />
                Active team ({approved.length})
              </h3>
              <div style={{ overflowX: "auto", borderRadius: 9, border: `1.5px solid ${T.border}` }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Name", "Email", "Role", "Approved by", "Actions"].map(h => (
                        <th key={h} style={{ padding: "10px 14px", background: T.elev, borderBottom: `2px solid ${T.borderStrong}`, fontSize: 11, fontWeight: 700, color: T.muted, textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--m)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {approved.map(u => (
                      <tr key={u.id}>
                        <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.borderFaint}`, fontSize: 13, fontWeight: 700, color: T.textStrong }}>{u.name}</td>
                        <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.borderFaint}`, fontSize: 12.5, color: T.text, fontFamily: "var(--m)" }}>{u.email}</td>
                        <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.borderFaint}` }}>
                          <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)} style={selectStyle} disabled={u.id === currentUser.id}>
                            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.borderFaint}`, fontSize: 12, color: T.muted }}>{u.approved_by ? "✓" : "—"}</td>
                        <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.borderFaint}` }}>
                          {u.id !== currentUser.id && (
                            <button onClick={() => handleReject(u.id)} style={{ padding: "4px 10px", borderRadius: 5, border: `1.5px solid ${T.red}`, background: "transparent", color: T.red, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>Revoke</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Rejected */}
            {rejected.length > 0 && (
              <div>
                <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800, color: T.red, display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.red }} />
                  Rejected ({rejected.length})
                </h3>
                {rejected.map(u => (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${T.borderFaint}`, fontSize: 13, color: T.muted }}>
                    <span style={{ fontWeight: 700, color: T.text }}>{u.name}</span>
                    <span style={{ fontFamily: "var(--m)" }}>{u.email}</span>
                    <button onClick={() => handleApprove(u.id, "viewer")} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 5, border: `1.5px solid ${T.green}`, background: "transparent", color: T.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Re-approve</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
