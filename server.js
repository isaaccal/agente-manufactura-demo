const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════
// BASE DE DATOS SIMULADA DE PROSCAI
// En producción: SELECT * FROM Produccion WHERE fecha BETWEEN...
// ═══════════════════════════════════════════════════════════
const DB = {
  semana_actual: {
    periodo: "3–9 Mar 2025",
    turnos: [
      { turno: "Matutino",   piezas_prog: 1200, piezas_ok: 1143, rechazos: 87,  paro_min: 95,  causa: "Falla compresor L3 (65min) + cambio molde (30min)" },
      { turno: "Vespertino", piezas_prog: 1100, piezas_ok: 1089, rechazos: 23,  paro_min: 18,  causa: "Ajuste de calibración" },
      { turno: "Nocturno",   piezas_prog: 900,  piezas_ok: 761,  rechazos: 44,  paro_min: 142, causa: "Corte de energía no programado" },
    ],
    inventario: [
      { material: "Resina ABS",           stock: 2340, minimo: 1500, unidad: "kg",   proveedor: "Química del Norte SA",    email_proveedor: "ventas@quimicanorte.mx",  precio_unit: 45,  tiempo_entrega: "3 días" },
      { material: "Pigmento Negro",        stock: 180,  minimo: 200,  unidad: "kg",   proveedor: "Colorantes Industriales",  email_proveedor: "pedidos@colorantes.mx",   precio_unit: 280, tiempo_entrega: "5 días" },
      { material: "Aditivo Estabilizador", stock: 95,   minimo: 100,  unidad: "kg",   proveedor: "Aditivos Especiales SA",   email_proveedor: "compras@aditivos.mx",     precio_unit: 520, tiempo_entrega: "7 días" },
      { material: "Cajas de Empaque",      stock: 3200, minimo: 1000, unidad: "pzas", proveedor: "Empaque y Diseño SA",      email_proveedor: "ventas@empaque.mx",       precio_unit: 8.5, tiempo_entrega: "2 días" },
    ]
  },
  semana_anterior: {
    periodo: "24 Feb–2 Mar 2025",
    turnos: [
      { turno: "Matutino",   piezas_prog: 1200, piezas_ok: 1198, rechazos: 31, paro_min: 22,  causa: "Cambio de molde programado" },
      { turno: "Vespertino", piezas_prog: 1100, piezas_ok: 1095, rechazos: 19, paro_min: 25,  causa: "Mantenimiento preventivo" },
      { turno: "Nocturno",   piezas_prog: 900,  piezas_ok: 891,  rechazos: 15, paro_min: 30,  causa: "Limpieza de línea" },
    ]
  }
};

// ═══════════════════════════════════════════════════════════
// HERRAMIENTAS DEL AGENTE
// ═══════════════════════════════════════════════════════════
const TOOLS = [
  {
    type: "function",
    function: {
      name: "obtener_datos_produccion",
      description: "Obtiene los datos de producción por turno de la semana actual y la anterior desde el ERP Proscai. Incluye piezas producidas, rechazos y tiempos de paro.",
      parameters: {
        type: "object",
        properties: {
          semana: { type: "string", enum: ["actual", "anterior", "ambas"], description: "Qué semana consultar" }
        },
        required: ["semana"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "obtener_inventario",
      description: "Obtiene el inventario actual de materias primas desde Proscai, incluyendo stock actual vs mínimo requerido.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "generar_orden_compra",
      description: "Genera una orden de compra para materiales que están por debajo del mínimo. Calcula cantidad a pedir para cubrir 4 semanas de producción.",
      parameters: {
        type: "object",
        properties: {
          material: { type: "string", description: "Nombre del material a ordenar" },
          cantidad: { type: "number", description: "Cantidad a pedir" },
          justificacion: { type: "string", description: "Razón de la compra urgente" }
        },
        required: ["material", "cantidad", "justificacion"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "comparar_semanas",
      description: "Compara el desempeño de producción entre la semana actual y la anterior, calculando variaciones porcentuales.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "enviar_reporte_correo",
      description: "Envía el reporte ejecutivo final por correo electrónico al destinatario especificado.",
      parameters: {
        type: "object",
        properties: {
          destinatario: { type: "string", description: "Email del destinatario" },
          asunto: { type: "string", description: "Asunto del correo" },
          contenido_html: { type: "string", description: "Contenido del reporte en formato HTML" }
        },
        required: ["destinatario", "asunto", "contenido_html"]
      }
    }
  }
];

// ═══════════════════════════════════════════════════════════
// EJECUTOR DE HERRAMIENTAS
// ═══════════════════════════════════════════════════════════
async function ejecutarHerramienta(nombre, args, config) {
  switch (nombre) {

    case "obtener_datos_produccion": {
      if (args.semana === "actual") return { datos: DB.semana_actual.turnos, periodo: DB.semana_actual.periodo };
      if (args.semana === "anterior") return { datos: DB.semana_anterior.turnos, periodo: DB.semana_anterior.periodo };
      return { actual: { datos: DB.semana_actual.turnos, periodo: DB.semana_actual.periodo }, anterior: { datos: DB.semana_anterior.turnos, periodo: DB.semana_anterior.periodo } };
    }

    case "obtener_inventario": {
      return { inventario: DB.semana_actual.inventario, alertas: DB.semana_actual.inventario.filter(m => m.stock < m.minimo).map(m => m.material) };
    }

    case "generar_orden_compra": {
      const mat = DB.semana_actual.inventario.find(m => m.material.toLowerCase().includes(args.material.toLowerCase()));
      if (!mat) return { error: "Material no encontrado" };
      const folio = `OC-2025-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      const total = (args.cantidad * mat.precio_unit).toFixed(2);
      return {
        folio,
        material: mat.material,
        cantidad: args.cantidad,
        unidad: mat.unidad,
        proveedor: mat.proveedor,
        precio_unitario: mat.precio_unit,
        total_mxn: total,
        tiempo_entrega: mat.tiempo_entrega,
        justificacion: args.justificacion,
        fecha: new Date().toLocaleDateString('es-MX'),
        estado: "GENERADA"
      };
    }

    case "comparar_semanas": {
      const act = DB.semana_actual.turnos;
      const ant = DB.semana_anterior.turnos;
      const totalActual = act.reduce((s, t) => s + t.piezas_ok, 0);
      const totalAnterior = ant.reduce((s, t) => s + t.piezas_ok, 0);
      const rechazosActual = act.reduce((s, t) => s + t.rechazos, 0);
      const rechazosAnterior = ant.reduce((s, t) => s + t.rechazos, 0);
      const parosActual = act.reduce((s, t) => s + t.paro_min, 0);
      const parosAnterior = ant.reduce((s, t) => s + t.paro_min, 0);
      return {
        produccion: { actual: totalActual, anterior: totalAnterior, variacion_pct: (((totalActual - totalAnterior) / totalAnterior) * 100).toFixed(1) },
        rechazos: { actual: rechazosActual, anterior: rechazosAnterior, variacion_pct: (((rechazosActual - rechazosAnterior) / rechazosAnterior) * 100).toFixed(1) },
        paros: { actual: parosActual, anterior: parosAnterior, variacion_pct: (((parosActual - parosAnterior) / parosAnterior) * 100).toFixed(1) },
        periodo_actual: DB.semana_actual.periodo,
        periodo_anterior: DB.semana_anterior.periodo
      };
    }

    case "enviar_reporte_correo": {
      if (!config.emailUser || !config.emailPass) return { error: "Credenciales de correo no configuradas" };
      try {
        const transporter = nodemailer.createTransport({
          host: config.emailHost || 'smtp.gmail.com',
          port: parseInt(config.emailPort) || 587,
          secure: false,
          auth: { user: config.emailUser, pass: config.emailPass }
        });
        await transporter.sendMail({
          from: `"Agente NubeConnect" <${config.emailUser}>`,
          to: args.destinatario,
          subject: args.asunto,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
              <div style="background:#1B3A6B;padding:20px;border-radius:8px 8px 0 0">
                <h2 style="color:white;margin:0">🤖 Agente IA · NubeConnect</h2>
                <p style="color:#93C5FD;margin:4px 0 0">Reporte Automático de Producción</p>
              </div>
              <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
                ${args.contenido_html}
              </div>
              <p style="color:#9CA3AF;font-size:12px;text-align:center;margin-top:12px">
                Generado automáticamente por Agente IA · NubeConnect · nubeconnect.com
              </p>
            </div>`
        });
        return { enviado: true, destinatario: args.destinatario, timestamp: new Date().toISOString() };
      } catch (err) {
        return { error: "Error al enviar correo: " + err.message };
      }
    }

    default:
      return { error: "Herramienta no encontrada" };
  }
}

// ═══════════════════════════════════════════════════════════
// ENDPOINT PRINCIPAL — AGENTE CON LOOP
// ═══════════════════════════════════════════════════════════
app.post('/api/agente', async (req, res) => {
  const { apiKey, config, instrucciones } = req.body;

  if (!apiKey?.startsWith('sk-')) return res.status(400).json({ error: 'API key de OpenAI inválida.' });

  const systemPrompt = `Eres un agente de análisis de producción industrial para ${config.empresa || 'Manufacturas del Norte SA'}.
Tu trabajo es analizar los datos del ERP Proscai y generar reportes ejecutivos accionables.

INSTRUCCIONES DEL USUARIO:
${instrucciones}

COMPORTAMIENTO:
- Usa las herramientas disponibles para obtener datos reales del ERP
- SIEMPRE compara con la semana anterior
- SIEMPRE revisa inventarios y genera órdenes de compra si hay materiales bajo mínimo
- Para cada orden de compra, calcula cantidad suficiente para 4 semanas
- Si el usuario pidió enviar por correo, usa la herramienta de envío con HTML profesional
- Sé directo y usa números concretos
- Al final, presenta un resumen ejecutivo en markdown con todas las acciones tomadas`;

  const messages = [{ role: "user", content: `Ejecuta el análisis completo según estas instrucciones: ${instrucciones}` }];
  const pasos = [];
  const ordenesGeneradas = [];

  try {
    let iteraciones = 0;
    const MAX_ITER = 10;

    while (iteraciones < MAX_ITER) {
      iteraciones++;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 2000, temperature: 0.3 })
      });

      if (!response.ok) {
        const err = await response.json();
        return res.status(400).json({ error: err.error?.message || 'Error OpenAI' });
      }

      const data = await response.json();
      const msg = data.choices[0].message;
      messages.push(msg);

      // Si no hay más tool calls, terminamos
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return res.json({
          reporte: msg.content,
          pasos,
          ordenes: ordenesGeneradas,
          tokens: data.usage?.total_tokens || 0,
          iteraciones
        });
      }

      // Ejecutar todas las herramientas llamadas
      const toolResults = [];
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        const resultado = await ejecutarHerramienta(tc.function.name, args, config);

        pasos.push({ herramienta: tc.function.name, args, resultado, timestamp: new Date().toISOString() });

        if (tc.function.name === 'generar_orden_compra' && resultado.folio) {
          ordenesGeneradas.push(resultado);
        }

        toolResults.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(resultado) });
      }

      messages.push(...toolResults);
    }

    res.status(500).json({ error: 'El agente superó el límite de iteraciones.' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ENDPOINT: DATOS PARA EL DASHBOARD
// ═══════════════════════════════════════════════════════════
app.get('/api/datos', (req, res) => res.json(DB));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agente v2 corriendo en puerto ${PORT}`));
