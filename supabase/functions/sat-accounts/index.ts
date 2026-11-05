import { createClient } from "npm:@supabase/supabase-js@2";

const officialDelegations = new Set([
  "Chinandega", "León", "Managua", "Masaya", "Rivas", "Carazo", "Granada",
  "Jinotega", "Matagalpa", "Nueva Segovia", "Estelí", "Madriz", "Boaco",
  "Chontales", "Río San Juan", "RACCN", "RACCS",
]);

const productionOrigin = "https://silviotif89.github.io";
const allowedOrigins = new Set([
  productionOrigin,
  "http://127.0.0.1:4173",
]);
const corsHeaders = (request: Request) => {
  const requestOrigin = request.headers.get("Origin") || productionOrigin;
  return {
    ...(allowedOrigins.has(requestOrigin)
      ? { "Access-Control-Allow-Origin": requestOrigin }
      : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
};
const respond = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });

async function verifyNewAccount(
  url: string,
  publishableKey: string,
  adminClient: ReturnType<typeof createClient>,
  delegation: string,
  authUserId: string,
  email: string,
  initialPassword: string,
) {
  const verifier = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await verifier.auth.signInWithPassword({
    email,
    password: initialPassword,
  });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error("No se pudo iniciar sesión con la contraseña inicial.");
  }

  const initialAccount = await verifier.rpc("sat_my_account");
  if (
    initialAccount.error || !Array.isArray(initialAccount.data) ||
    initialAccount.data.length !== 1 ||
    initialAccount.data[0].delegation !== delegation ||
    initialAccount.data[0].must_change_password !== true
  ) {
    throw new Error("Falló la validación de la delegación o del cambio inicial.");
  }

  const testPassword = "SatTest!" + crypto.randomUUID() + "9";
  const passwordChange = await verifier.auth.updateUser({ password: testPassword });
  if (passwordChange.error) {
    throw new Error("No se pudo completar la prueba de cambio de contraseña.");
  }
  const completedChange = await verifier.rpc("sat_complete_password_change");
  if (completedChange.error) {
    throw new Error("No se pudo confirmar el cambio obligatorio de contraseña.");
  }

  const activeAccount = await verifier.rpc("sat_my_account");
  const activeDelegation = await verifier.rpc("sat_current_delegation");
  if (
    activeAccount.error || !Array.isArray(activeAccount.data) ||
    activeAccount.data.length !== 1 ||
    activeAccount.data[0].must_change_password !== false ||
    activeDelegation.error || activeDelegation.data !== delegation
  ) {
    throw new Error("La sesión autenticada no quedó vinculada a su delegación.");
  }

  for (const table of ["sat_november_2026_plans", "sat_monthly_plans"]) {
    const ownRows = await verifier.from(table).select("delegation").limit(100);
    if (ownRows.error || ownRows.data.some((row) => row.delegation !== delegation)) {
      throw new Error("La prueba de aislamiento devolvió registros de otra delegación.");
    }
    const otherDelegation = delegation === "Managua" ? "Jinotega" : "Managua";
    const crossRows = await verifier.from(table)
      .select("delegation")
      .eq("delegation", otherDelegation);
    if (crossRows.error || crossRows.data.length !== 0) {
      throw new Error("La prueba detectó acceso a otra delegación.");
    }
  }

  const temporaryPassword = initialPassword;
  const prepareReset = await adminClient.rpc("sat_service_prepare_reset", {
    target: delegation,
  });
  if (prepareReset.error) {
    throw new Error("No se pudo volver a exigir el cambio inicial de contraseña.");
  }
  const finalPassword = await adminClient.auth.admin.updateUserById(authUserId, {
    password: temporaryPassword,
  });
  if (finalPassword.error) {
    throw new Error("No se pudo dejar la contraseña temporal de entrega.");
  }
  await verifyResetAccount(url, publishableKey, delegation, email, temporaryPassword, true);
  return temporaryPassword;
}

async function verifyResetAccount(
  url: string,
  publishableKey: string,
  delegation: string,
  email: string,
  temporaryPassword: string,
  enabled: boolean,
) {
  const verifier = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await verifier.auth.signInWithPassword({ email, password: temporaryPassword });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error("No se pudo iniciar sesión con la contraseña restablecida.");
  }
  const account = await verifier.rpc("sat_my_account");
  if (account.error) throw new Error("No se pudo verificar la cuenta restablecida.");
  if (enabled) {
    if (
      !Array.isArray(account.data) || account.data.length !== 1 ||
      account.data[0].delegation !== delegation ||
      account.data[0].must_change_password !== true
    ) throw new Error("El restablecimiento no exige cambio inicial de contraseña.");
  } else if (Array.isArray(account.data) && account.data.length !== 0) {
    throw new Error("Una cuenta deshabilitada obtuvo acceso al SAT.");
  }
  const activeDelegation = await verifier.rpc("sat_current_delegation");
  if (activeDelegation.error || activeDelegation.data !== null) {
    throw new Error("La contraseña temporal habilitó acceso antes del cambio obligatorio.");
  }
  for (const table of ["sat_november_2026_plans", "sat_monthly_plans"]) {
    const rows = await verifier.from(table).select("delegation").limit(100);
    if (rows.error || rows.data.length !== 0) {
      throw new Error("La cuenta restablecida pudo leer datos antes del cambio obligatorio.");
    }
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (request.method !== "POST") return respond(request, { error: "Método inválido" }, 405);
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return respond(request, { error: "Sesión requerida" }, 401);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publishableKey = request.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY");
    if (!publishableKey) {
      return respond(request, { error: "No está disponible la clave pública para verificar accesos." }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return respond(request, { error: "Sesión inválida" }, 401);
    if (user.email !== "ddt36@intur.local") {
      return respond(request, { error: "Acceso denegado" }, 403);
    }

    let body: { delegation?: unknown; action?: unknown; temporaryPassword?: unknown };
    try {
      body = await request.json();
    } catch {
      return respond(request, { error: "Solicitud inválida" }, 400);
    }
    const { delegation, action = "create", temporaryPassword: requestedPassword } = body;
    if (typeof delegation !== "string" || !delegation.trim() || delegation.length > 100) {
      return respond(request, { error: "Delegación inválida" }, 400);
    }
    if (!officialDelegations.has(delegation)) {
      return respond(request, { error: "Seleccioná una de las 17 delegaciones oficiales." }, 400);
    }
    if (action === "create" && requestedPassword !== undefined &&
      (typeof requestedPassword !== "string" || requestedPassword.length < 8 || requestedPassword.length > 72 ||
        !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?: [A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*\*\d{4}$/.test(requestedPassword))) {
      return respond(request, { error: "Usá el formato nombre*año, con cuatro dígitos al final." }, 400);
    }
    const { data: account, error } = await supabase.rpc("sat_service_account", {
      target: delegation,
    });
    if (error || !account) return respond(request, { error: "Delegación inválida" }, 400);
    const slug = delegation.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replaceAll(" ", "-");

    if (action === "reset") {
      if (!account.auth_user_id) return respond(request, { error: "Cuenta sin configurar" }, 409);
      const temporaryPassword = Deno.env.get("SAT_RESET_TEMP_PASSWORD");
      if (
        !temporaryPassword || temporaryPassword.length < 8 || temporaryPassword.length > 72 ||
        !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?: [A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*\*\d{4}$/.test(temporaryPassword)
      ) {
        return respond(request, { error: "La contraseña temporal institucional no está configurada en Supabase. No se cambió la contraseña." }, 503);
      }
      const audit = await supabase.rpc("sat_service_start_password_reset", {
        p_delegation: delegation,
        p_admin_id: user.id,
      });
      if (audit.error || typeof audit.data !== "string") {
        return respond(request, { error: "No se pudo registrar el restablecimiento. No se cambió la contraseña." }, 409);
      }
      const eventId = audit.data;
      let resetOutcome: "EXITOSO" | "FALLIDO" = "FALLIDO";
      try {
        const prepared = await supabase.rpc("sat_service_prepare_reset", { target: delegation });
        if (prepared.error) throw new Error("No se pudo preparar el restablecimiento.");
        const reset = await supabase.auth.admin.updateUserById(account.auth_user_id, {
          password: temporaryPassword,
        });
        if (reset.error) {
          throw new Error("El acceso quedó protegido. Volvé a intentar el restablecimiento.");
        }
        await verifyResetAccount(
          supabaseUrl,
          publishableKey,
          delegation,
          slug + "@delegaciones.intur.local",
          temporaryPassword,
          account.enabled === true,
        );
        resetOutcome = "EXITOSO";
      } catch (error) {
        await supabase.rpc("sat_service_finish_password_reset", {
          p_event_id: eventId,
          p_admin_id: user.id,
          p_outcome: "FALLIDO",
        });
        const message = error instanceof Error && error.message
          ? error.message
          : "El restablecimiento no superó la prueba de acceso protegido.";
        return respond(request, { error: message }, 409);
      }
      const finished = await supabase.rpc("sat_service_finish_password_reset", {
        p_event_id: eventId,
        p_admin_id: user.id,
        p_outcome: resetOutcome,
      });
      if (finished.error) {
        // The temporary password must still reach the administrator because Auth
        // already accepted it; the audit row remains visible as INICIADO for repair.
        return respond(request, {
          delegation,
          temporaryPassword,
          verified: true,
          auditPending: true,
          checks: { login: true, forcedChange: true, dataBlocked: true },
        }, 200);
      }
      return respond(request, {
        delegation,
        temporaryPassword,
        verified: true,
        auditPending: false,
        checks: { login: true, forcedChange: true, dataBlocked: true },
      });
    }
    if (action !== "create") return respond(request, { error: "Operación inválida" }, 400);
    if (account.auth_user_id) return respond(request, { error: "La cuenta ya existe" }, 409);

    const initialPassword = typeof requestedPassword === "string"
      ? requestedPassword
      : "Sat!" + crypto.randomUUID() + "9";
    const created = await supabase.auth.admin.createUser({
      email: slug + "@delegaciones.intur.local",
      password: initialPassword,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      return respond(request, { error: "No se pudo crear la cuenta" }, 409);
    }
    const authUserId = created.data.user.id;
    const linked = await supabase.rpc("sat_service_link", {
      target: delegation,
      account_id: authUserId,
    });
    if (linked.error) {
      await supabase.auth.admin.deleteUser(authUserId);
      return respond(request, { error: "No se pudo vincular la cuenta" }, 409);
    }

    try {
      const temporaryPassword = await verifyNewAccount(
        supabaseUrl,
        publishableKey,
        supabase,
        delegation,
        authUserId,
        slug + "@delegaciones.intur.local",
        initialPassword,
      );
      return respond(request, {
        delegation,
        username: delegation,
        temporaryPassword,
        verified: true,
        checks: { login: true, forcedChange: true, passwordChange: true, isolation: true, resetToTemporary: true },
      });
    } catch {
      const unlinked = await supabase.rpc("sat_service_unlink", {
        target: delegation,
        account_id: authUserId,
      });
      if (!unlinked.error) {
        await supabase.auth.admin.deleteUser(authUserId);
      } else {
        return respond(request, {
          error: "La prueba falló y el sistema no pudo revertir el vínculo; restablecé la cuenta desde Admin antes de volver a intentarlo.",
        }, 409);
      }
      return respond(request, {
        error: "La cuenta no superó la prueba real de acceso y aislamiento; se revirtió su alta para proteger el SAT.",
      }, 409);
    }
  } catch {
    return respond(request, { error: "No se pudo completar la operación" }, 500);
  }
});
