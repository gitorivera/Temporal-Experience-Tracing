# GAME-SPECS — Cambios recomendados en el juego para sincronizar con TET

> Para quien programa el juego (versión de realidad mixta en Meta Quest y la futura versión de tablet).
> Describe qué debe hacer el juego para que las trazas de la app TET se puedan alinear con el EEG.
> La parte de la app TET está en [SPEC-tet-video.md](SPEC-tet-video.md) §16.

## 1. Por qué hacen falta estos cambios

El EEG y los eventos del juego quedan en el **reloj LSL**. Las trazas TET quedan en el **tiempo del video** de la partida, porque el niño traza mientras lo ve. Para buscar en el EEG patrones que correspondan a las trazas, hay que traducir cada instante del video a tiempo LSL.

Para eso el juego marca, varias veces durante la partida, un instante que queda **a la vez** en el video y en LSL: un **destello** visible en la imagen y un **marcador LSL** enviado en el mismo cuadro. La app TET encuentra los destellos en el video, los empareja con los marcadores y calcula la traducción.

¿Por qué varios destellos y no uno? La grabación de la Quest pasa por la transmisión a la app Meta Horizon del celular. Esa transmisión tiene un retraso (del orden de 0,1 a 0,3 s) y puede perder o repetir cuadros cuando la wifi falla. Con un solo destello solo se corrige el retraso inicial. Con un destello cada minuto, la app corrige también la deriva y los saltos de la transmisión, tramo a tramo.

## 2. Requisitos en una tabla

| # | Requisito | Valor recomendado |
|---|---|---|
| 1 | Primer destello y marcador `sync_1` | Al pulsar el botón «Iniciar partida» |
| 2 | Destellos intermedios `sync_2`, `sync_3`, … | Cada 60 s de partida |
| 3 | Último destello `sync_N` | Al terminar la partida, antes de cualquier pantalla final |
| 4 | Duración del destello | 300 ms |
| 5 | Marcador y destello | En el **mismo cuadro**: el marcador se envía en el primer cuadro en que el destello se dibuja |
| 6 | Forma | Cuadrado blanco puro con un marco negro, fijo a la cabeza, encima de todo lo demás |
| 7 | Posición | Arriba del centro de la vista (unos 10° por encima), **no** en una esquina |
| 8 | Etiquetas | `sync_1`, `sync_2`, … en orden; todas empiezan por `sync` |
| 9 | Otros eventos | Mismo stream de marcadores, con los nombres de la §5 |

## 3. Los destellos

### 3.1 Cuándo

- **`sync_1` al pulsar «Iniciar partida».** El botón que aparece frente al jugador es el disparador natural: en el mismo cuadro en que se registra la pulsación se muestra el primer destello y se envían dos marcadores, `sync_1` e `inicio partida`.
- **Uno cada 60 s** mientras dure la partida (`sync_2`, `sync_3`, …). En una partida típica de 5 minutos salen unos 6 o 7 destellos.
- **Uno al final** (`sync_N`), justo al terminar la partida.
- Si la partida se pausa, el reloj de los 60 s puede seguir o detenerse; da igual, siempre que cada destello lleve su marcador.
- Entre dos destellos debe haber **al menos 10 s**: si el temporizador de 60 s queda muy cerca del final, se omite ese destello intermedio y se deja solo el del final.

La app empareja los destellos con los marcadores por orden y comprueba que los intervalos entre destellos en el video sean iguales a los intervalos entre marcadores en LSL. Por eso un destello perdido o uno de más se detecta.

### 3.2 Cómo se ve

- **Cuadrado blanco puro** (`#FFFFFF`) de unos **8° de ángulo visual**, con un **marco negro** de alrededor de 1°. El marco garantiza contraste aunque la escena sea clara.
- **Fijo a la cabeza** (head-locked): se mueve con la vista, para que siempre salga en la grabación.
- **Arriba del centro**, unos 10° por encima de la línea de la mirada. **No en una esquina:** la transmisión de la Quest al celular recorta los bordes de la imagen de cada ojo, y un destello en la esquina podría no salir en el video.
- **Encima de todo:** sin profundidad (en Unity, un shader *unlit* con `ZTest Always` y una cola de render alta), sin niebla, sin post-procesado ni efectos que cambien su brillo.
- **300 ms de duración.** El celular graba la transmisión a unos 30 cuadros por segundo, así que 300 ms son unos 9 cuadros: alcanza para detectarlo aunque se pierdan algunos.
- Aparece y desaparece de golpe, sin fundidos, para que su inicio sea un cuadro preciso.

Para el jugador es un parpadeo breve arriba de la vista, una vez por minuto. Si molesta en el piloto, se puede reducir a 6° o subirlo un poco más, pero sin salir de la zona central.

### 3.3 El marcador en el mismo cuadro

- El marcador `sync_k` se envía en **el mismo cuadro** en que el destello se activa (en Unity, en el mismo `Update` en que se activa el objeto), con la marca de tiempo de LSL de ese momento (`local_clock()` / `LSL.LSL.local_clock()`).
- Entre ese instante y el momento en que el destello aparece en la pantalla del visor hay un retraso fijo de unas decenas de milisegundos. Ese retraso es igual para todos los destellos y la app no lo corrige; es mucho menor que la resolución de las trazas (10 Hz).
- No enviar el marcador «cuando termine el destello» ni con retraso: siempre al **inicio**.

## 4. Stream LSL de marcadores

Si el juego ya envía eventos por LSL, basta con agregar los marcadores `sync_k` a ese mismo stream. Si se crea uno nuevo:

| Campo | Valor |
|---|---|
| Nombre | p. ej. `JuegoEventos` |
| Tipo | `Markers` |
| Canales | 1 |
| Frecuencia nominal | 0 (irregular) |
| Formato | `string` |
| `source_id` | fijo, p. ej. `juego-rm-quest` (así LabRecorder reconecta si se cae) |

- Cada evento es **una muestra** con una cadena: la etiqueta.
- El EEG va en su propio stream. LabRecorder graba los dos en el mismo archivo XDF y registra la diferencia de relojes entre la Quest y el computador. Al cargar el XDF, `pyxdf` deja todo en el mismo reloj.

## 5. Nombres de los eventos del juego

La app TET asigna un ícono a cada evento según su etiqueta (SPEC §8.1). Con estos nombres, la línea de tiempo del niño muestra los íconos correctos:

| Evento | Etiqueta recomendada | Ícono en TET |
|---|---|---|
| Destellos | `sync_1`, `sync_2`, … | (no se muestran: son la referencia) |
| Pulsación de «Iniciar partida» | `inicio partida` | 🚩 |
| Comienzo de un nivel | `inicio nivel 1`, `inicio nivel 2`, … | 🚩 |
| Respuesta correcta | `acierto` | ⭐ |
| Respuesta incorrecta | `error` | ❌ |
| Premio o recompensa | `premio` | 🎁 |
| Fin de la partida | `fin partida` | 🏁 |

Se puede agregar información después del nombre (`acierto objetivo 3`), siempre que la primera palabra sea la del evento.

**Qué ve el niño** (decisión del investigador, 2026-10-07): para no recargar la línea de tiempo, la pantalla de trazado muestra solo los **combos de 3 aciertos**, marcados en el tercero (`acierto objetivo 3`), los **premios** y los **inicios** de partida y de nivel. No muestra los errores, el fin de partida ni los demás aciertos. Por eso el juego debe conservar el número de objetivo en la etiqueta del acierto. Si ningún acierto lo trae, se muestran todos los aciertos. Los archivos de salida de TET guardan todos los eventos.

## 6. Grabación del video

### 6.1 Realidad mixta (Quest → app Meta Horizon en el celular)

- **Empezar a grabar antes** de que el jugador pulse «Iniciar partida», y **detener después** del último destello. Si el video no contiene los destellos, no hay sincronización.
- Quest y celular en la **misma red wifi de 5 GHz**, cerca del router y sin otras transmisiones pesadas: cada corte de la transmisión es un salto en el video.
- En el celular: **no molestar** activado (sin notificaciones encima de la imagen), pantalla siempre encendida y batería suficiente.
- Grabar a **30 cuadros por segundo o más**, en la resolución que permita la app.
- Tras cada partida, revisar que en el video se vean los destellos, sobre todo el primero y el último.

### 6.2 Tablet (pendiente)

La versión de tablet todavía no existe. Recomendaciones para cuando exista:

- Lo más sencillo es la **grabación de pantalla de Android** (o la que traiga la tablet) iniciada antes de la partida. El destello se puede dibujar como un cuadrado blanco con marco negro en la parte superior central de la pantalla, con el mismo tamaño relativo y la misma duración.
- Si el juego puede grabar su propia pantalla, mejor: evita depender de otra app.
- En la tablet no hay recorte de bordes, pero se recomienda la misma posición para que la detección funcione igual en las dos versiones.

## 7. Exportar los eventos para la app TET

La app TET lee un CSV con una columna de tiempo y una de etiqueta (SPEC §8.1). Desde el XDF de LabRecorder, exportar **solo el stream de marcadores del juego**:

```csv
tiempo,evento
1532.400,sync_1
1532.400,inicio partida
1535.100,inicio nivel 1
1561.800,acierto
1592.400,sync_2
1590.250,error
```

- Separador **coma** y **punto** decimal (con coma decimal, usar `;`: ver el aviso de la pantalla de configuración).
- Los tiempos son los de LSL, ya corregidos por `pyxdf`. El orden de las filas no importa: la app las ordena.
- **Script `tet-video/scripts/xdf_a_eventos.py`** (se agrega en la fase 9 de la app, SPEC §16.7): lee el XDF con `pyxdf`, toma el stream de marcadores del juego y escribe este CSV. Uso previsto:

  ```
  pip install pyxdf
  python scripts/xdf_a_eventos.py sesion_P01.xdf -o eventos_P01.csv
  ```

  Por omisión usa el stream `JuegoEventos` e ignora los demás (p. ej. `ColorQuestMarkers`, el stream detallado del juego). Con `--stream` se elige otro. Si el archivo no tiene `JuegoEventos`, usa el único stream de tipo `Markers`, y si hay varios, pide elegir.

## 8. Lista de comprobación antes del piloto

1. El stream de marcadores aparece en LabRecorder junto al EEG.
2. Al pulsar «Iniciar partida» llegan `sync_1` e `inicio partida`, y se ve el destello en el visor.
3. Durante una partida de 5 minutos llegan unos 6 o 7 marcadores `sync_k`, cada uno separado del anterior por unos 60 s.
4. En el video grabado en el celular se ven **todos** los destellos, completos y sin recorte.
5. El CSV exportado tiene una fila `sync_k` por cada destello del video.
6. En la app TET, la pantalla de configuración encuentra el mismo número de destellos que filas `sync`, con un error residual bajo (ver SPEC §16).

> Aprobado por el investigador el 2026-10-06: destello cada 60 s, 300 ms, arriba del centro de la vista.
