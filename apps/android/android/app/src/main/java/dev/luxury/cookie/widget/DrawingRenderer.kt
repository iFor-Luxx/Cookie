package dev.luxury.cookie.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import org.json.JSONArray
import org.json.JSONObject

/**
 * H6/H8: render vectorial local del documento (JSON) para el widget.
 * Puerto fiel de packages/drawing/src/renderer.ts (misma semilla, mismo grano).
 * El widget NO usa la preview: dibuja el JSON del último dibujo a máxima
 * calidad en el tamaño real del widget, sin red ni DOM.
 */
object DrawingRenderer {
    /** Tope de bitmap para caber en el binder de RemoteViews (~460KiB ARGB_565). */
    const val MAX_SIDE = 480
    private const val BACKGROUND = "#FFFFFF"
    private const val INK = "#222222"

    fun renderDocument(widgetWidthPx: Int, widgetHeightPx: Int, doc: JSONObject): Bitmap {
        val side = min(MAX_SIDE, min(widgetWidthPx, widgetHeightPx)).coerceAtLeast(64)
        val bmp = Bitmap.createBitmap(side, side, Bitmap.Config.RGB_565)
        val canvas = Canvas(bmp)
        val canvasObj = doc.optJSONObject("canvas")
        val background = canvasObj?.optString("background").orEmpty()
        canvas.drawColor(safeColor(background))
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            isAntiAlias = true
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val canvasWidth = canvasObj?.optInt("width", side) ?: side
        val canvasHeight = canvasObj?.optInt("height", side) ?: side
        val strokes = doc.optJSONArray("strokes") ?: return bmp
        for (i in 0 until strokes.length()) {
            renderStroke(canvas, paint, canvasWidth, canvasHeight, side, strokes.optJSONObject(i) ?: continue)
        }
        return bmp
    }

    private fun renderStroke(
        canvas: Canvas,
        paint: Paint,
        canvasWidth: Int,
        canvasHeight: Int,
        targetSide: Int,
        stroke: JSONObject,
    ) {
        val points = stroke.optJSONArray("points") ?: return
        if (points.length() == 0) return
        val tool = stroke.optString("tool", "graphite")
        val color = stroke.optString("color", INK)
        val size = stroke.optDouble("size", 3.0).toFloat()
        val opacity = stroke.optDouble("opacity", 1.0).toFloat()
        val seed = stroke.optInt("seed", 1)
        val pts = toPixels(points, canvasWidth, canvasHeight, size, targetSide, tool == "rotring")
        val rand = Mulberry32(seed)

        if (tool == "marker") {
            val path = smoothedPath(applyWobble(pts, rand, 0.02))
            for ((a, b) in path) {
                segment(canvas, paint, a.x, a.y, b.x, b.y, a.w, b.w, color, opacity)
            }
            // Bordes secos: motas en la banda exterior, alfa tenue.
            val edges = min(pts.size * 3, 180)
            for (s in 0 until edges) {
                val i = (rand.next() * pts.size).toInt()
                val c = pts[i]
                val ang = rand.next() * Math.PI * 2
                val dist = c.w * (0.3 + rand.next() * 0.4)
                stamp(
                    canvas, paint,
                    (c.x + cos(ang) * dist).toFloat(),
                    (c.y + sin(ang) * dist).toFloat(),
                    max(0.3f, c.w * 0.09f),
                    color, opacity * 0.22f,
                )
            }
            return
        }

        // pen: tinta sólida uniforme (sin taper ni grano), extremos suaves.
        if (tool == "pen") {
            val path = smoothedPath(applyWobble(pts, rand, 0.03))
            for (i in path.indices) {
                val (a, b) = path[i]
                val w = (a.w + b.w) / 2f
                val w0 = if (i == 0) w * 0.55f else w
                val w1 = if (i == path.size - 1) w * 0.55f else w
                segment(canvas, paint, a.x, a.y, b.x, b.y, w0, w1, color, opacity)
            }
            return
        }

        if (tool == "rotring") {
            for ((a, b) in smoothedPath(pts)) {
                segment(canvas, paint, a.x, a.y, b.x, b.y, a.w, b.w, color, opacity)
            }
            return
        }

        // spray: nube con caída central (sin cuerpo).
        if (tool == "spray") {
            val stamps = min(pts.size * 12, 600)
            for (s in 0 until stamps) {
                val i = (rand.next() * pts.size).toInt()
                val c = pts[i]
                val ang = rand.next() * Math.PI * 2
                // r1*r2 concentra al centro; cada 8ª mota es salpicadura.
                val dist = c.w * 1.5 * rand.next() * rand.next()
                val blob = if (s % 8 == 0) 2.5 else 1.0
                stamp(
                    canvas,
                    paint,
                    (c.x + cos(ang) * dist).toFloat(),
                    (c.y + sin(ang) * dist).toFloat(),
                    max(0.4f, (c.w * (0.15 + rand.next() * 0.3) * blob).toFloat()),
                    color,
                    (opacity * (0.1 + rand.next() * 0.3)).toFloat(),
                )
            }
            return
        }

        // marker2: bisel en 3 capas translúcidas con jitter lateral (cerdas).
        if (tool == "marker2") {
            val layers = listOf(1.0f, 0.85f, 0.7f)
            for (f in layers) {
                for ((a, b) in smoothedPath(pts)) {
                    val j = ((a.w + b.w) / 2f) * 0.3f
                    val jx = ((rand.next() - 0.5) * j).toFloat()
                    val jy = ((rand.next() - 0.5) * j).toFloat()
                    segment(
                        canvas, paint,
                        a.x + jx, a.y + jy, b.x + jx, b.y + jy,
                        a.w * f, b.w * f, color, opacity * 0.4f,
                    )
                }
            }
            return
        }

        // hatch: línea tenue + ticks perpendiculares (sombreado técnico).
        if (tool == "hatch") {
            for ((a, b) in smoothedPath(applyWobble(pts, rand, 0.05))) {
                segment(canvas, paint, a.x, a.y, b.x, b.y, a.w * 0.5f, b.w * 0.5f, color, opacity * 0.35f)
                val w = (a.w + b.w) / 2f
                val dx = (b.x - a.x).toDouble()
                val dy = (b.y - a.y).toDouble()
                val len = hypot(dx, dy).let { if (it == 0.0) 1.0 else it }
                val tilt = (rand.next() - 0.5) * 0.4
                val nx = -dy / len * cos(tilt) - dx / len * sin(tilt)
                val ny = -dy / len * sin(tilt) + dx / len * cos(tilt)
                for (k in 0 until 2) {
                    val t = rand.next()
                    val cx = (a.x + dx * t + (rand.next() - 0.5) * w * 0.4).toFloat()
                    val cy = (a.y + dy * t + (rand.next() - 0.5) * w * 0.4).toFloat()
                    val l = (w * (0.8 + rand.next() * 0.7)).toFloat()
                    val tw = max(0.5f, w * 0.15f)
                    segment(
                        canvas, paint,
                        (cx - nx * l / 2).toFloat(), (cy - ny * l / 2).toFloat(),
                        (cx + nx * l / 2).toFloat(), (cy + ny * l / 2).toFloat(),
                        tw, tw, color, opacity * 0.7f,
                    )
                }
            }
            return
        }

        // Familia de grano (graphite, pencil, 2b, 2h, cpencil, charcoal).
        // Desconocido → grafito (compatibilidad hacia adelante).
        val p = grainParamsFor(tool)
        val wpts = applyWobble(pts, rand, p.wobble)
        val path = smoothedPath(wpts)
        if (p.haloWidth > 0f) {
            for ((a, b) in path) {
                segment(canvas, paint, a.x, a.y, b.x, b.y, a.w * p.haloWidth, b.w * p.haloWidth, color, opacity * p.haloAlpha)
            }
        }
        for (pass in 0 until p.passes) {
            for ((a, b) in path) {
                val pressureScale = 0.35f + 0.65f * ((a.w + b.w) / 2f / max(size, 0.5f))
                val alpha = alphaFor(opacity, pressureScale) * p.alphaFactor
                segment(canvas, paint, a.x, a.y, b.x, b.y, a.w * p.widthFactor, b.w * p.widthFactor, color, alpha)
            }
            // Grano: mismo orden que renderer.ts (i, ángulo, distancia,
            // jitter, descarte, alfa).
            val grains = min(wpts.size * p.grainPerPoint, p.grainCap)
            for (g in 0 until grains) {
                val i = (rand.next() * wpts.size).toInt()
                val c = wpts[i]
                val ang = rand.next() * Math.PI * 2
                val dist = rand.next() * c.w * p.spread
                val jitter = p.jitterMin + rand.next() * p.jitterSpan
                val skip = rand.next() < p.drySkip
                val alpha = p.grainAlphaMin + rand.next() * p.grainAlphaSpan
                if (skip) continue
                stamp(
                    canvas,
                    paint,
                    (c.x + cos(ang) * dist).toFloat(),
                    (c.y + sin(ang) * dist).toFloat(),
                    max(0.4f, (c.w * p.radiusFactor * jitter).toFloat()),
                    color,
                    alpha.toFloat(),
                )
            }
        }
    }

    private class GrainParams(
        val passes: Int,
        val widthFactor: Float,
        val alphaFactor: Float,
        val grainPerPoint: Int,
        val grainCap: Int,
        val spread: Double,
        val jitterMin: Double,
        val jitterSpan: Double,
        val grainAlphaMin: Double,
        val grainAlphaSpan: Double,
        val radiusFactor: Double,
        val wobble: Double,
        val haloWidth: Float,
        val haloAlpha: Float,
        val drySkip: Double,
    )

    private val GRAPHITE_PARAMS = GrainParams(
        passes = 1, widthFactor = 0.9f, alphaFactor = 0.9f,
        grainPerPoint = 3, grainCap = 240, spread = 0.45,
        jitterMin = 0.4, jitterSpan = 0.9,
        grainAlphaMin = 0.16, grainAlphaSpan = 0.22, radiusFactor = 0.14,
        wobble = 0.08, haloWidth = 0f, haloAlpha = 0f, drySkip = 0.0,
    )

    private val GRAIN_TOOLS: Map<String, GrainParams> = mapOf(
        "graphite" to GRAPHITE_PARAMS,
        "pencil" to GrainParams(
            passes = 2, widthFactor = 0.9f, alphaFactor = 0.5f,
            grainPerPoint = 3, grainCap = 240, spread = 0.45,
            jitterMin = 0.5, jitterSpan = 2.0,
            grainAlphaMin = 0.16, grainAlphaSpan = 0.22, radiusFactor = 0.12,
            wobble = 0.14, haloWidth = 0f, haloAlpha = 0f, drySkip = 0.0,
        ),
        "2b" to GrainParams(
            passes = 1, widthFactor = 1.0f, alphaFactor = 0.95f,
            grainPerPoint = 5, grainCap = 320, spread = 0.55,
            jitterMin = 0.5, jitterSpan = 1.2,
            grainAlphaMin = 0.2, grainAlphaSpan = 0.25, radiusFactor = 0.16,
            wobble = 0.12, haloWidth = 2.0f, haloAlpha = 0.2f, drySkip = 0.0,
        ),
        "2h" to GrainParams(
            passes = 1, widthFactor = 0.7f, alphaFactor = 0.55f,
            grainPerPoint = 1, grainCap = 60, spread = 0.35,
            jitterMin = 0.3, jitterSpan = 0.5,
            grainAlphaMin = 0.12, grainAlphaSpan = 0.15, radiusFactor = 0.08,
            wobble = 0.02, haloWidth = 0f, haloAlpha = 0f, drySkip = 0.0,
        ),
        "cpencil" to GrainParams(
            passes = 2, widthFactor = 0.95f, alphaFactor = 0.7f,
            grainPerPoint = 4, grainCap = 280, spread = 0.6,
            jitterMin = 0.8, jitterSpan = 2.2,
            grainAlphaMin = 0.14, grainAlphaSpan = 0.2, radiusFactor = 0.18,
            wobble = 0.14, haloWidth = 0f, haloAlpha = 0f, drySkip = 0.1,
        ),
        "charcoal" to GrainParams(
            passes = 1, widthFactor = 1.1f, alphaFactor = 0.9f,
            grainPerPoint = 6, grainCap = 400, spread = 0.8,
            jitterMin = 0.6, jitterSpan = 1.6,
            grainAlphaMin = 0.12, grainAlphaSpan = 0.25, radiusFactor = 0.18,
            wobble = 0.18, haloWidth = 2.8f, haloAlpha = 0.22f, drySkip = 0.15,
        ),
    )

    private fun grainParamsFor(tool: String): GrainParams =
        GRAIN_TOOLS[tool] ?: GRAPHITE_PARAMS

    /**
     * Temblor de mano: mismo orden y fórmula que renderer.ts (1 llamada
     * por punto interior, extremos anclados).
     */
    private fun applyWobble(
        pts: List<Px>,
        rand: Mulberry32,
        amount: Double,
    ): List<Px> {
        if (amount <= 0.0 || pts.size < 3) return pts
        return pts.mapIndexed { i, p ->
            if (i == 0 || i == pts.size - 1) return@mapIndexed p
            val prev = pts[i - 1]
            val next = pts[i + 1]
            val dx = (next.x - prev.x).toDouble()
            val dy = (next.y - prev.y).toDouble()
            val len = hypot(dx, dy).let { if (it == 0.0) 1.0 else it }
            val o = (rand.next() * 2 - 1) * amount * p.w
            Px(
                (p.x + (-dy / len) * o).toFloat(),
                (p.y + (dy / len) * o).toFloat(),
                p.w,
            )
        }
    }

    private class Px(val x: Float, val y: Float, val w: Float)

    private fun toPixels(
        points: JSONArray,
        canvasWidth: Int,
        canvasHeight: Int,
        size: Float,
        targetSide: Int,
        ignorePressure: Boolean = false,
    ): List<Px> {
        val sx = targetSide.toFloat() / canvasWidth
        val sy = targetSide.toFloat() / canvasHeight
        val scale = (sx + sy) / 2f
        val out = ArrayList<Px>(points.length())
        for (i in 0 until points.length()) {
            val p = points.optJSONArray(i) ?: continue
            val x = p.optDouble(0, 0.0).toFloat()
            val y = p.optDouble(1, 0.0).toFloat()
            val pressure = p.optDouble(2, 0.0).toFloat()
            out.add(
                Px(
                    x = x * canvasWidth * sx,
                    y = y * canvasHeight * sy,
                    w = if (ignorePressure) {
                        max(0.5f, size * scale)
                    } else {
                        max(0.5f, size * (0.25f + 0.75f * pressure) * scale)
                    },
                ),
            )
        }
        return out
    }

    private fun smoothedPath(pts: List<Px>): List<Pair<Px, Px>> {
        if (pts.isEmpty()) return emptyList()
        if (pts.size == 1) return listOf(pts[0] to pts[0])
        val out = ArrayList<Pair<Px, Px>>(pts.size)
        var prev = pts[0]
        var cursor = midpoint(prev, pts[1])
        out.add(prev to cursor)
        for (i in 1 until pts.size - 1) {
            val a = pts[i]
            val b = pts[i + 1]
            cursor = midpoint(a, b)
            out.add(prev to cursor)
            prev = cursor
        }
        out.add(prev to pts[pts.size - 1])
        return out
    }

    private fun midpoint(a: Px, b: Px): Px =
        Px((a.x + b.x) / 2f, (a.y + b.y) / 2f, (a.w + b.w) / 2f)

    private fun alphaFor(opacity: Float, pressureScale: Float): Float =
        min(1f, opacity * pressureScale)

    private fun segment(
        canvas: Canvas,
        paint: Paint,
        x0: Float,
        y0: Float,
        x1: Float,
        y1: Float,
        w0: Float,
        w1: Float,
        color: String,
        alpha: Float,
    ) {
        applyColor(paint, color, alpha)
        paint.style = Paint.Style.STROKE
        val mx = (x0 + x1) / 2f
        val my = (y0 + y1) / 2f
        paint.strokeWidth = w0
        canvas.drawLine(x0, y0, mx, my, paint)
        paint.strokeWidth = w1
        canvas.drawLine(mx, my, x1, y1, paint)
    }

    private fun stamp(
        canvas: Canvas,
        paint: Paint,
        x: Float,
        y: Float,
        r: Float,
        color: String,
        alpha: Float,
    ) {
        applyColor(paint, color, alpha)
        paint.style = Paint.Style.FILL
        canvas.drawCircle(x, y, r, paint)
    }

    private fun applyColor(paint: Paint, hex: String, alpha: Float) {
        paint.color = safeColor(hex)
        paint.alpha = (alpha.coerceIn(0f, 1f) * 255f).roundToInt()
    }

    private fun safeColor(hex: String): Int =
        try {
            Color.parseColor(hex)
        } catch (_: IllegalArgumentException) {
            Color.parseColor(BACKGROUND)
        }

    /** mulberry32 determinista (misma semilla por trazo que el renderer web). */
    private class Mulberry32(seed: Int) {
        private var a: Int = seed

        fun next(): Double {
            a += 0x6d2b79f5
            var t = (a xor (a ushr 15)) * (1 or a)
            t = (t + (t xor (t ushr 7)) * (61 or t)) xor t
            return ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL).toDouble() / 4294967296.0
        }
    }
}