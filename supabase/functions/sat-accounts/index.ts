import { createClient } from "npm:@supabase/supabase-js@2";

const origin = "https://silviotif89.github.io";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return respond({ error: "Método inválido" }, 405);
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return respond({ error: "Sesión requerida" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user } } = await supabase.auth.getUser(token);
  if (user?.email !== "ddt36@intur.local") return respond({ error: "Acceso denegado" }, 403);

  try {
    const { delegation, action = "create" } = await request.json();
    if (typeof delegation !== "string") return respond({ error: "Delegación inválida" }, 400);
    const { data: account, error } = await supabase.rpc("sat_service_account", { target: delegation });
    if (error || !account) return respond({ error: "Delegación inválida" }, 400);
    const slug = delegation.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replaceAll(" ", "-");
    const password = "Sat!" + crypto.randomUUID() + "9";
    if (action === "reset") {
      if (!account.auth_user_id) return respond({ error: "Cuenta sin configurar" }, 409);
      const { error: resetError } = await supabase.rpc("sat_service_prepare_reset", { target: delegation });
      if (resetError) return respond({ error: "No se pudo preparar el restablecimiento" }, 409);
      const result = await supabase.auth.admin.updateUserById(account.auth_user_id, { password });
      if (result.error) return respond({ error: "El acceso quedó protegido. Volvé a intentar el restablecimiento." }, 409);
    } else if (action !== "create") {
      return respond({ error: "Operación inválida" }, 400);
    } else if (account.auth_user_id) {
      return respond({ error: "La cuenta ya existe" }, 409);
    } else {
      const result = await supabase.auth.admin.createUser({
        email: slug + "@delegaciones.intur.local", password, email_confirm: true,
      });
      if (result.error || !result.data.user) return respond({ error: "No se pudo crear la cuenta" }, 409);
      const id = result.data.user.id;
      const link = await supabase.rpc("sat_service_link", { target: delegation, account_id: id });
      if (link.error) {
        await supabase.auth.admin.deleteUser(id);
        return respond({ error: "No se pudo vincular la cuenta" }, 409);
      }
    }
    return respond({ delegation, temporaryPassword: password });
  } catch {
    return respond({ error: "No se pudo completar la operación" }, 500);
  }
});
