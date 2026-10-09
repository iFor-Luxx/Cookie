# 7. Motor de dibujo y formato canónico

## Objetivos

- Capturar mouse, touch y stylus con baja latencia; responder al input antes de red o API.
- Renderizar texturas creíbles sin trabajo costoso dentro del ciclo de React.
- Mantener un documento reproducible en web y Android; formato versionado y migrable.
- Preservar presión/inclinación si la plataforma las reporta; degradar con input uniforme en hardware básico.
- Separar input, formato, herramientas, render, export y upload.

## Modelo de documento

Geometría normalizada en rango 0..1, trazos ordenados, presión/inclinación y semilla determinista por trazo. Añadir timestamps por punto solo cuando una función los requiera.

```json
{
  "schemaVersion": 1,
  "canvas": {"width": 1024, "height": 1024, "background": "#FFFFFF"},
  "strokes": [{
    "id": "stroke_uuid", "tool": "graphite", "color": "#333333",
    "size": 3.2, "opacity": 0.82, "seed": 92831,
    "points": [[0.10, 0.22, 0.4, 0], [0.11, 0.23, 0.7, 0.1]]
  }]
}
```

Cada punto representa `(x, y, pressure, tilt)`. No guardar referencias DOM, ImageBitmap ni rutas temporales en el documento.

## Herramientas MVP

| Herramienta | Render recomendado | Controles |
|---|---|---|
| Grafito | Stamp de punta con grano determinista, opacidad sensible a presión/velocidad y acumulación moderada. | Tamaño, presión/sensibilidad y dureza simulada. |
| Lápiz de color | Textura fibrosa direccional, pigmento parcialmente transparente y huecos de cobertura sutiles. | Color, tamaño, densidad/capas y presión. |
| Rotulador | Trazo estable, bordes suavizados, color semitransparente y acumulación controlada en cruces. | Color, ancho y opacidad. |
| Acuarela | Fuera del MVP. | Evaluar luego difusión y mezcla de pigmento. |

Las texturas deben ser propias o tener licencia documentada para distribuirlas con la app. Una librería de dibujo requiere evaluación de presión, calidad, bundle, memoria, consumo y licencia en Android real.

## Pipeline de input/render

1. Capturar pointer event sin actualizar el árbol React por cada punto.
2. Añadir muestras a un buffer mutable/TypedArray del stroke activo.
3. Interpolar/suavizar con algoritmo de coste acotado, nunca cuadrático respecto al número de puntos.
4. Renderizar preview en capa transitoria; confirmar el stroke al levantar puntero.
5. Registrar undo/redo como acciones; no duplicar bitmaps completos por cada acción.
6. Guardar local con debounce, sin bloquear el input.
7. Publicar desde snapshot consistente y generar preview/export fuera del movimiento activo.

```ts
interface DrawingEngine {
  beginStroke(input: PointerSample, tool: BrushConfig): void;
  appendSamples(samples: readonly PointerSample[]): void;
  endStroke(): StrokeId;
  undo(): boolean;
  redo(): boolean;
  renderPreview(target: RenderTarget, quality: RenderQuality): void;
  exportDocument(): VersionedDrawingDocument;
  dispose(): void;
}
```

## Rendimiento del canvas

- El loop de input usa buffers y `requestAnimationFrame`; no React state por punto.
- Usar eventos coalesced cuando estén disponibles y limitar memoria del buffer.
- Separar capas de fondo, trazos confirmados, stroke activo y controles.
- Evitar limpiar/redibujar todo el canvas si cambió una región pequeña.
- Escalar backing store por DPR con límite configurable en hardware débil.
- Acotar undo por memoria, liberar bitmaps y texturas al salir.
- Evitar render full-resolution mientras se dibuja; generar export de alta calidad al publicar.
- Medir en teléfonos físicos, incluidas gama media y baja.

## Render reproducible y export

- `seed` produce variación de grano determinista.
- Documento vectorial es canónico; preview/render son derivados reemplazables.
- Metadata de render incluye `rendererVersion` si cambios alteran apariencia.
- Preview objetivo: lado máximo de 512 px y típicamente menos de 150 KiB.
- Export produce checksum; backend verifica hash, MIME, tamaño y dimensiones.
- Render server-side queda fuera del MVP. Si se requiere, agregar job de render versionado en vez de hacerlo en request síncrono.

## Accesibilidad del lienzo

Selector de herramienta, color, tamaño y acciones llevan labels accesibles. Color no es la única señal de estado. Controles externos al canvas son navegables por teclado; exponer herramienta seleccionada y estado de guardado. La selección de paleta visual queda a cargo del producto.
