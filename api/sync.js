// ============================================================================
// SQL QUEST RPG — VERCEL SERVERLESS CLOUD SYNC ENDPOINT (/api/sync)
// Sincronización en la Nube con Vercel KV / Upstash Redis (100% Gratuito)
// ============================================================================

export default async function handler(req, res) {
  // Configuración de cabeceras CORS para permitir llamadas desde móvil y desktop
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Detectar variables de entorno inyectadas automáticamente por Vercel Storage KV
  const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

  if (!kvUrl || !kvToken) {
    return res.status(503).json({
      ok: false,
      error: 'KV_NOT_CONFIGURED',
      message: 'Vercel KV no está conectado aún en la pestaña Storage del proyecto pixca. Ve a Vercel -> Storage -> Create Database -> KV.'
    });
  }

  try {
    // ------------------------------------------------------------------------
    // GET: Recuperar progreso por PIN
    // ------------------------------------------------------------------------
    if (req.method === 'GET') {
      const pin = (req.query.pin || '').toString().trim().toLowerCase();
      if (!pin) {
        return res.status(400).json({
          ok: false,
          error: 'MISSING_PIN',
          message: 'Debes proporcionar un PIN o nombre de usuario (?pin=victor)'
        });
      }

      // Sanitizar key
      const safePin = pin.replace(/[^a-z0-9_-]/g, '').slice(0, 32);
      const key = `sqlquest_${safePin}`;

      const endpoint = `${kvUrl}/get/${encodeURIComponent(key)}`;
      const resp = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });

      if (!resp.ok) {
        return res.status(502).json({
          ok: false,
          error: 'KV_FETCH_ERROR',
          status: resp.status,
          message: 'Error al consultar la base de datos KV en Vercel.'
        });
      }

      const data = await resp.json();
      let state = null;
      if (data && data.result) {
        try {
          state = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
        } catch (_) {
          state = data.result;
        }
      }

      return res.status(200).json({
        ok: true,
        pin: safePin,
        found: Boolean(state),
        state: state
      });
    }

    // ------------------------------------------------------------------------
    // POST: Guardar o actualizar progreso por PIN
    // ------------------------------------------------------------------------
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (_) {}
      }

      const pin = (body?.pin || '').toString().trim().toLowerCase();
      const state = body?.state;

      if (!pin || !state) {
        return res.status(400).json({
          ok: false,
          error: 'INVALID_PAYLOAD',
          message: 'Se requiere el campo "pin" y el objeto "state".'
        });
      }

      const safePin = pin.replace(/[^a-z0-9_-]/g, '').slice(0, 32);
      const key = `sqlquest_${safePin}`;

      // Inyectar marca de tiempo de sincronización en el estado
      if (typeof state === 'object' && state !== null) {
        state._cloudUpdatedAt = Date.now();
        state._cloudPin = safePin;
      }

      const payloadString = typeof state === 'string' ? state : JSON.stringify(state);

      // Usar comando universal POST de Upstash/Vercel KV REST
      const resp = await fetch(kvUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SET', key, payloadString])
      });

      if (!resp.ok) {
        return res.status(502).json({
          ok: false,
          error: 'KV_SAVE_ERROR',
          status: resp.status,
          message: 'Error al escribir en la base de datos KV en Vercel.'
        });
      }

      return res.status(200).json({
        ok: true,
        pin: safePin,
        updatedAt: Date.now(),
        message: 'Progreso sincronizado con éxito en la nube de Vercel.'
      });
    }

    return res.status(405).json({
      ok: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Sólo se admiten métodos GET y POST.'
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'SERVER_EXCEPTION',
      message: err.message || 'Error interno del servidor'
    });
  }
}

