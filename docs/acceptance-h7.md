# Aceptación H7 (mapeo SDD §12)

| # | Criterio | Estado H7 |
|---|---|---|
| 1 | Onboarding con nombre + invite 1-uso | ✅ tests pairing/API + UI |
| 2 | Historial común para ambos | ✅ timeline + tests E2E |
| 3 | Publicación visible sin refresco manual | ✅ notify + WS/polling + reconcile |
| 4 | Reinstalar no borra; recovery autorizado | ✅ challenge+secret, test ata a B |
| 5 | Retry misma key no duplica | ✅ idempotencia + tests |
| 6 | Offline conserva y converge o error corregible | ✅ outbox durable + badge + retry |
| 7 | Gap/expiración → delta o snapshot sin saltos | ✅ reconcile + `snapshotRequired` |
| 8 | Widget última preview + best-effort comunicado | ✅ provider/cache + README límites |
| 9 | Revoke cierra HTTP/WS y desactiva FCM | ✅ sessions+push limpios + evict DO |
| 10 | Otro PairSpace no lee/modifica cambiando IDs | ✅ membership por ruta + tests IDOR |
| 11 | Backup restaurable; sin secretos en logs; costos visibles | 🟡 runbooks + export + logs/metrics; restore real pendiente de staging |
| 12 | Canvas en presupuesto + degradado | 🟡 engine acotado + DPR cap; medición física pendiente (piloto). JS inicial 309 kB (93 gzip) sobre el objetivo 250 kB: History en lazy + chunk `ui`; resto a perfilar en H8 |
| 13 | Mismo core en web y Android | ✅ workspaces + wrapper sin UI propia |

🟡 = requiere dispositivo/staging real (H8 piloto).
