package dev.luxury.cookie.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import kotlin.math.cos
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
        val pts = toPixels(points, canvasWidth, canvasHeight, size, targetSide)
        val rand = Mulberry32(seed)

        if (tool == "marker") {
            for ((a, b) in smoothedPath(pts)) {
                segment(canvas, paint, a.x, a.y, b.x, b.y, a.w, b.w, color, opacity)
            }
            return
        }

        val passes = if (tool == "pencil") 2 else 1
        for (p in 0 until passes) {
            for ((a, b) in smoothedPath(pts)) {
                val pressureScale = 0.35f + 0.65f * ((a.w + b.w) / 2f / max(size, 0.5f))
                val alpha = alphaFor(opacity, pressureScale) *
                    (if (tool == "pencil") 0.55f else 0.9f)
                segment(canvas, paint, a.x, a.y, b.x, b.y, a.w * 0.9f, b.w * 0.9f, color, alpha)
            }
            // Grano determinista dentro de la banda del trazo (mismo orden de
            // llamadas a rand() que renderer.ts para que coincida byte a byte).
            val grains = min(pts.size * 3, 240)
            for (g in 0 until grains) {
                val i = (rand.next() * pts.size).toInt()
                val c = pts[i]
                val ang = rand.next() * Math.PI * 2
                val dist = rand.next() * c.w
                val jitter = if (tool == "pencil") {
                    0.5 + rand.next() * 1.4
                } else {
                    0.4 + rand.next() * 0.9
                }
                val alpha = 0.16 + rand.next() * 0.22
                stamp(
                    canvas,
                    paint,
                    (c.x + cos(ang) * dist).toFloat(),
                    (c.y + sin(ang) * dist).toFloat(),
                    max(0.4, c.w * 0.08 * jitter).toFloat(),
                    color,
                    alpha.toFloat(),
                )
            }
        }
    }

    private class Px(val x: Float, val y: Float, val w: Float)

    private fun toPixels(
        points: JSONArray,
        canvasWidth: Int,
        canvasHeight: Int,
        size: Float,
        targetSide: Int,
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
                    w = max(0.5f, size * (0.25f + 0.75f * pressure) * scale),
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