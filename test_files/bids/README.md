# Estructura BIDS del experimento (Study 1)

Conjunto de datos del Study 1: **flow en realidad mixta frente a tablet**, con EEG de alta
densidad (BioSemi ActiveTwo) y Temporal Experience Tracing (TET).

Diseño intra-sujeto: cada participante juega **ColorQuest** en las dos modalidades dentro de la
misma visita —unos 10 minutos cada una, en orden contrabalanceado— y después traza las 8
dimensiones sobre el video de su propia partida. El EEG es continuo, pero hay capturas sin gorro
(pilotos y, más adelante, niños del Study 2).

## Entidades

| Entidad | Valor | Qué significa |
| --- | --- | --- |
| `sub-<label>` | `001`, `002`, … | El participante. Un número por persona, en el orden en que entra al estudio. |
| `ses-<label>` | `01` | La **visita**. Study 1 tiene una sola; quedan `02`, `03`… por si Study 2 agrega más. |
| `task-<label>` | `colorquest` | Siempre la misma: el juego es la misma tarea en las dos modalidades. |
| `acq-<label>` | `quest`, `tablet` | **La condición**: el aparato con el que se jugó esa pasada. |
| `run-<index>` | `001`, `002` | El **orden dentro de la visita**: `001` es la modalidad que se jugó primero. |
| Carpeta de modalidad | `eeg/`, `beh/` | `eeg/` cuando el participante tenía el gorro puesto; `beh/` cuando no. |

Dos consecuencias de poner la condición en `acq-` y el orden en `run-`:

- La condición de cada archivo se lee en su nombre, sin mirar tablas.
- El contrabalanceo también: `run-001` con `acq-tablet` es un participante del orden
  tablet → Quest. En `participants.tsv` queda además la columna `order`.

## Qué se escribe en LabRecorder

**Study Root:**

```txt
C:\Users\gitor\Documents\Unity\Temporal-Experience-Tracing\test_files\bids\sourcedata
```

Apunta a `sourcedata/`, no a la raíz: lo que graba LabRecorder es material de origen (ver abajo).

**File Name/Template:**

```txt
sub-%p\ses-%s\%m\run-%r[_acq-%a]\sub-%p_ses-%s_task-%b[_acq-%a]_run-%r_%m.xdf
```

Es la plantilla BIDS que ya trae LabRecorder con **una subcarpeta más por pasada**
(`run-001_acq-quest/`). Hace falta porque los scripts de `tet-video/scripts/` dan por hecho
**una captura por carpeta**: con las dos pasadas sueltas en la misma carpeta, `integridad.py` y
`quest_videos.py` tomarían el primer XDF en orden alfabético y los dos videos se mezclarían.

> **Por comprobar:** que esta versión de LabRecorder cree esa subcarpeta. Si no la crea, deja la
> plantilla por omisión y mueve cada pasada a su carpeta a mano antes de correr los scripts.

**Campos, visita de ejemplo** (participante 001, orden Quest → tablet, con gorro):

| Campo | Primera pasada | Segunda pasada |
| --- | --- | --- |
| Participant (`%p`) | `001` | `001` |
| Session (`%s`) | `01` | `01` |
| Block/Task (`%b`) | `colorquest` | `colorquest` |
| Acq. (`%a`) | `quest` | `tablet` |
| Run (`%r`) | `1` | `2` |
| Modality (`%m`) | `eeg` | `eeg` |

Si en esa pasada no hubo EEG, lo único que cambia es `Modality` → `beh`.

Entre pasada y pasada **solo se tocan `Acq.` y `Run`**. Los nombres salen así:

```txt
sub-001_ses-01_task-colorquest_acq-quest_run-001_eeg.xdf
sub-001_ses-01_task-colorquest_acq-tablet_run-002_eeg.xdf
```

Notas de los campos:

- Las etiquetas de BIDS son alfanuméricas: `001` y `01`, sin `P` ni `S`. Con `P001` el conjunto
  queda como `sub-P001`, que es válido pero arrastra la `P` en todos los archivos.
- `Run` se escribe `1` y LabRecorder lo guardó como `run-001` en la prueba del 7 de octubre que
  quedó en `test_files/`. Si tu versión escribe `run-1`, también es válido; lo importante es que
  todas las capturas usen la misma forma.
- `Block/Task` es un desplegable: hay que agregarle `colorquest` una vez.

## Cómo queda el conjunto

```txt
test_files/bids/
├── dataset_description.json
├── participants.tsv              una fila por participante (edad, sexo, orden, awareness)
├── participants.json
├── task-colorquest_beh.json      sidecar de las pasadas sin EEG
├── task-colorquest_events.json   qué significa cada columna de los *_events.tsv
├── sub-001/
│   └── ses-01/
│       ├── sub-001_ses-01_scans.tsv
│       ├── eeg/
│       │   ├── sub-001_ses-01_task-colorquest_acq-quest_run-001_eeg.vhdr   (.eeg, .vmrk)
│       │   ├── sub-001_ses-01_task-colorquest_acq-quest_run-001_eeg.json
│       │   ├── sub-001_ses-01_task-colorquest_acq-quest_run-001_channels.tsv
│       │   ├── sub-001_ses-01_task-colorquest_acq-quest_run-001_events.tsv
│       │   └── … lo mismo para acq-tablet_run-002
│       └── beh/                  solo en las pasadas sin gorro
│           ├── sub-001_ses-01_task-colorquest_acq-tablet_run-002_beh.json
│           └── sub-001_ses-01_task-colorquest_acq-tablet_run-002_events.tsv
├── sourcedata/                   lo de los aparatos, y eeg_defaults.json (ver su README)
└── derivatives/
    └── tet/                      las trazas del participante
```

`sourcedata/` y `derivatives/` quedan fuera de lo que revisa el validador de BIDS, así que ahí
pueden vivir el XDF, los videos y los NDJSON tal como salen de los aparatos.

## Por qué el XDF no es el dato crudo

BIDS solo admite como EEG crudo **BrainVision (`.vhdr`/`.eeg`/`.vmrk`), EDF, BDF y EEGLAB
(`.set`)**. El `.xdf` de LabRecorder no está en esa lista, así que se queda en `sourcedata/` y de
él se genera el EEG en BrainVision más los `_events.tsv`, `_channels.tsv` y `_scans.tsv`.

## La conversión

La hace `tet-video/scripts/xdf_a_bids.py`, que lee las entidades del nombre del XDF y escribe
todo lo de arriba. Desde `tet-video/`:

```bash
python scripts/xdf_a_bids.py ../test_files/bids/sourcedata
```

Convierte todas las pasadas que encuentre debajo de esa carpeta; también acepta una visita o un
`.xdf` suelto. Opciones útiles: `--sobrescribir` para rehacer lo ya convertido, `--referencia`,
`--fabricante`, `--modelo` y `--red-hz` para los campos del equipo de EEG, `--ritmo efectivo`
cuando el ritmo medido no coincide con el nominal, y `--sin-tet` para no tocar los derivados.

**El tiempo cero de cada pasada es la primera muestra del EEG.** Los eventos del juego y las
trazas de TET se pasan a ese reloj restando ese instante de su `tiempo_lsl_s`, que es el mismo
reloj LSL que ya corrigió pyxdf. En una pasada sin EEG el cero es el primer marcador del juego.

El script avisa cuando algo no cuadra: el ritmo efectivo lejos del nominal (BrainVision supone
muestras parejas), ninguna fila sync, o trazas de TET que no se cruzan con la grabación —señal de
que los archivos de TET son de otra pasada.

### Los campos fijos del equipo

Lo que no cambia de una pasada a otra —fabricante, referencia, descripción de la tarea,
institución, frecuencia de la red— se escribe a mano en **`sourcedata/eeg_defaults.json`**, y el
conversor lo copia dentro del `_eeg.json` de cada pasada. Así cada sidecar queda completo, sin
depender de la herencia: el validador rechaza un `task-<tarea>_eeg.json` suelto en la raíz porque
no trae `SamplingFrequency`, que solo se sabe pasada por pasada.

Va en `sourcedata/` porque no es un archivo de BIDS. Lo que se pase por la línea de comandos
(`--referencia`, `--fabricante`, `--modelo`, `--red-hz`) manda sobre él, que es como se convierten
los pilotos grabados con otro equipo.

### Lo que dice el validador

Con las dos capturas piloto convertidas, `bids-validator` **no da ningún error**. Quedan dos
avisos, los dos esperados:

- `INCONSISTENT_SUBJECTS`: sale cuando un participante tiene `eeg/` y otro `beh/`. Es la
  consecuencia de marcar con `beh` las pasadas sin gorro; en el Study 1, donde todas llevan EEG,
  no aparece.
- `TOO_FEW_AUTHORS`: `dataset_description.json` tiene un solo autor. Se resuelve agregando a los
  demás cuando se decida la autoría.

## derivatives/tet

Lo que exporta la app TET, una copia por pasada, en la carpeta `beh/` del derivado:

| Archivo de TET | En el derivado |
| --- | --- |
| `TET_<…>_10hz.csv` | `sub-001_ses-01_task-colorquest_acq-quest_run-001_desc-tet_timeseries.tsv` |
| `TET_<…>_ventanas.csv` | `…_desc-tetventanas_events.tsv` |
| `TET_<…>_toques.csv` | `…_desc-tettoques_events.tsv` |
| `TET_<…>.json` | `…_desc-tet_sesion.json` |

El JSON de TET trae la sincronización, la ventana de trazado y la configuración de la sesión, así
que se conserva entero.

## Lo que falta

1. **Comprobar la plantilla** de LabRecorder con la subcarpeta `run-…` (arriba).
2. **Volver a validar con el primer participante de verdad.** Lo probado hasta ahora son los
   pilotos; el comando es `npx bids-validator@1.14.14 test_files/bids` (o, con Deno,
   `deno run -A jsr:@bids/validator test_files/bids`, que es el validador nuevo).
3. **Decidir qué pasa con `test_files/expNNN`**: son los pilotos, con otra convención. Pueden
   quedarse donde están o entrar como `sub-pilot01`, `sub-pilot02`…
4. **Poner el nombre de los canales** en la cabecera del stream de EEG: si no viene, el conversor
   los llama `Ch1`, `Ch2`… y hay que arreglar el `_channels.tsv` a mano.
5. **Completar `eeg_defaults.json`** cuando el equipo definitivo esté montado: hoy describe el
   BioSemi ActiveTwo de la preinscripción, no el Cyton de los pilotos.
