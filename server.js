const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── DATOS SIMULADOS DE PROSCAI ───────────────────────────────────────────────
// En producción real, esto vendría de:
// SELECT * FROM Produccion WHERE fecha BETWEEN ... AND ...
function getDatosProscai(semana) {
  const datos = {
    empresa: "Manufacturas del Norte S.A. de C.V.",
    periodo: semana === 'actual' ? "Semana del 3 al 9 de marzo 2025" : "Semana del 24 feb al 2 mar 2025",
    turnos: [
      {
        turno: "Matutino (6am–2pm)",
        operadores: 24,
        piezas_programadas: 1200,
        piezas_producidas: semana === 'actual' ? 1143 : 1198,
        piezas_rechazadas: semana === 'actual' ? 87 : 31,
        tiempo_paro_min: semana === 'actual' ? 95 : 22,
        causa_paro: semana === 'actual' ? "Falla en compresor línea 3 (65 min) + cambio de molde (30 min)" : "Cambio de molde programado"
      },
      {
        turno: "Vespertino (2pm–10pm)",
        operadores: 21,
        piezas_programadas: 1100,
        piezas_producidas: semana === 'actual' ? 1089 : 1095,
        piezas_rechazadas: semana === 'actual' ? 23 : 19,
        tiempo_paro_min: semana === 'actual' ? 18 : 25,
        causa_paro: semana === 'actual' ? "Ajuste de calibración (18 min)" : "Mantenimiento preventivo"
      },
      {
        turno: "Nocturno (10pm–6am)",
        operadores: 18,
        piezas_programadas: 900,
        piezas_producidas: semana === 'actual' ? 761 : 891,
        piezas_rechazadas: semana === 'actual' ? 44 : 15,
        tiempo_paro_min: semana === 'actual' ? 142 : 30,
        causa_paro: semana === 'actual' ? "Corte de energía no programado (142 min)" : "Limpieza de línea"
      }
    ],
    inventario_materias_primas: [
      { material: "Resina ABS", stock_kg: semana === 'actual' ? 2340 : 4100, minimo_kg: 1500, unidad: "kg" },
      { material: "Pigmento Negro", stock_kg: semana === 'actual' ? 180 : 420, minimo_kg: 200, unidad: "kg" },
      { material: "Aditivo Estabilizador", stock_kg: semana === 'actual' ? 95 : 310, minimo_kg: 100, unidad: "kg" },
      { material: "Cajas de Empaque", stock_kg: semana === 'actual' ? 3200 : 3800, minimo_kg: 1000, unidad: "piezas" }
    ],
    eficiencia_equipos: [
      { equipo: "Inyectora L1", eficiencia_pct: semana === 'actual' ? 94 : 97 },
      { equipa: "Inyectora L2", eficiencia_pct: semana === 'actual' ? 91 : 95 },
      { equipo: "Inyectora L3", eficiencia_pct: semana === 'actual' ? 67 : 96, alerta: semana === 'actual' ? "Falla en compresor" : null },
      { equipo: "Ensamble A1", eficiencia_pct: semana === 'actual' ? 88 : 92 }
    ]
  };
  return datos;
}

// ─── ENDPOINT: GENERAR REPORTE ────────────────────────────────────────────────
app.post('/api/generar-reporte', async (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey || !apiKey.startsWith('sk-')) {
    return res.status(400).json({ error: 'API key de OpenAI inválida o faltante.' });
  }

  const datosActual = getDatosProscai('actual');
  const datosAnterior = getDatosProscai('anterior');

  // Calcular totales
  const totalProducido = datosActual.turnos.reduce((s, t) => s + t.piezas_producidas, 0);
  const totalProgramado = datosActual.turnos.reduce((s, t) => s + t.piezas_programadas, 0);
  const totalRechazos = datosActual.turnos.reduce((s, t) => s + t.piezas_rechazadas, 0);
  const totalParos = datosActual.turnos.reduce((s, t) => s + t.tiempo_paro_min, 0);
  const totalProducidoAnt = datosAnterior.turnos.reduce((s, t) => s + t.piezas_producidas, 0);

  const prompt = `Eres el analista de producción senior de ${datosActual.empresa}.
Tu tarea es generar el reporte ejecutivo semanal de producción para el Gerente de Planta.

DATOS DE PROSCAI ERP — ${datosActual.periodo}:

PRODUCCIÓN POR TURNO:
${datosActual.turnos.map(t => `- ${t.turno}: ${t.piezas_producidas}/${t.piezas_programadas} piezas producidas, ${t.piezas_rechazadas} rechazos, ${t.tiempo_paro_min} min paro. Causa: ${t.causa_paro}`).join('\n')}

TOTALES SEMANA:
- Piezas producidas: ${totalProducido} de ${totalProgramado} programadas (${((totalProducido/totalProgramado)*100).toFixed(1)}% cumplimiento)
- Total rechazos: ${totalRechazos} piezas (${((totalRechazos/totalProducido)*100).toFixed(1)}% tasa de rechazo)
- Total paros: ${totalParos} minutos

COMPARATIVO SEMANA ANTERIOR: ${totalProducidoAnt} piezas producidas

INVENTARIO MATERIAS PRIMAS:
${datosActual.inventario_materias_primas.map(m => `- ${m.material}: ${m.stock_kg} ${m.unidad} (mínimo: ${m.minimo_kg} ${m.unidad}) ${m.stock_kg < m.minimo_kg ? '⚠️ BAJO MÍNIMO' : '✓'}`).join('\n')}

EFICIENCIA EQUIPOS:
${datosActual.eficiencia_equipos.map(e => `- ${e.equipo || e.equipa}: ${e.eficiencia_pct}%${e.alerta ? ' ⚠️ ' + e.alerta : ''}`).join('\n')}

Genera un reporte ejecutivo profesional en español con estas secciones exactas usando markdown:

## 📊 Resumen Ejecutivo
(2-3 oraciones que el gerente pueda leer en 20 segundos)

## ✅ Logros de la Semana
(lo que salió bien)

## ⚠️ Alertas y Problemas Críticos
(lo que necesita atención inmediata, con impacto en números)

## 📦 Situación de Inventarios
(qué materiales están en riesgo y qué acción tomar)

## 🎯 Recomendaciones para Esta Semana
(3-5 acciones concretas y específicas, con responsable sugerido)

## 📈 Comparativo vs Semana Anterior
(análisis de tendencia con números)

Sé directo, usa números específicos, evita paja. El gerente tiene 5 minutos para leer esto.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.4
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(400).json({ error: err.error?.message || 'Error con la API de OpenAI' });
    }

    const data = await response.json();
    const reporte = data.choices[0].message.content;

    res.json({
      reporte,
      datos: datosActual,
      meta: {
        tokens_usados: data.usage?.total_tokens || 0,
        modelo: 'gpt-4o-mini',
        tiempo_generacion: new Date().toISOString()
      }
    });

  } catch (err) {
    res.status(500).json({ error: 'Error de conexión: ' + err.message });
  }
});

// ─── ENDPOINT: DATOS CRUDOS (para mostrar "lo que viene del ERP") ─────────────
app.get('/api/datos-erp', (req, res) => {
  res.json(getDatosProscai('actual'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agente corriendo en puerto ${PORT}`));
