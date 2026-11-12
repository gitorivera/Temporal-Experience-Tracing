# sourcedata: lo que sale de los aparatos

Aquí queda el material de origen tal como lo escriben LabRecorder, la Quest, la tablet y la app
TET. Nada de esto es BIDS válido —el `.xdf` no es un formato de EEG admitido, y el video y el
NDJSON no son modalidades de BIDS—, así que vive en `sourcedata/`, que el validador no revisa.

LabRecorder apunta su **Study Root** a esta carpeta, de modo que el árbol de `sub-`/`ses-` lo
arma él solo. Los nombres y los campos están en el [README del conjunto](../README.md).

## Una pasada

```txt
sourcedata/sub-001/ses-01/eeg/run-001_acq-quest/
├── sub-001_ses-01_task-colorquest_acq-quest_run-001_eeg.xdf          LabRecorder
├── sub-001_ses-01_task-colorquest_acq-quest_run-001_eeg_eventos.csv  xdf_a_eventos
├── Casting_Video_<ms>.mp4                                            copia sin audio: esta carga TET
├── events_<participante>_<fecha UTC>.ndjson                          registro del juego
├── integridad.txt                                                    informe de integridad
├── original/
│   └── Casting_Video_<ms>.mp4                                        archivo exacto del aparato
└── traces/                                                           lo que exporta TET
    ├── TET_<…>.json
    ├── TET_<…>_10hz.csv
    ├── TET_<…>_ventanas.csv
    └── TET_<…>_toques.csv
```

Con la tablet el video se llama `screen_<participante>_<fecha UTC>.mp4`, y si esa pasada fue sin
gorro la carpeta de modalidad es `beh/` en vez de `eeg/`.

**Una pasada por carpeta.** Los scripts toman el primer XDF y el primer video en orden
alfabético, así que las dos pasadas de una visita no pueden compartir carpeta.

## Comandos de cada pasada

Se ejecutan dentro de `tet-video/`. `CARPETA` es la de la pasada, por ejemplo
`../test_files/bids/sourcedata/sub-001/ses-01/eeg/run-001_acq-quest`.

```bash
python scripts/xdf_a_eventos.py CARPETA/sub-001_ses-01_task-colorquest_acq-quest_run-001_eeg.xdf
```

```bash
python scripts/quest_videos.py sesion CARPETA
```

Con la tablet, `python scripts/tablet_videos.py sesion CARPETA` (y `--ultimo` si esa pasada no
tiene XDF). Después se traza en TET, se guarda lo exportado en `CARPETA/traces/` y se vuelve a
revisar con `python scripts/integridad.py CARPETA`.

El paso a paso completo está en la página de Notion «TET — Flujo de trabajo con los scripts de
Python»; aquí solo cambian las rutas.

## Y al final, el BIDS

Cuando la pasada ya tiene su XDF, sus eventos y sus trazas:

```bash
python scripts/xdf_a_bids.py CARPETA
```

Escribe el EEG en BrainVision, los TSV y los derivados de TET fuera de `sourcedata/`. Sin
argumentos de carpeta concreta, `python scripts/xdf_a_bids.py ../test_files/bids/sourcedata`
convierte todas las pasadas de una vez (lo ya convertido no se rehace sin `--sobrescribir`).

`eeg_defaults.json`, aquí al lado, trae los campos fijos del equipo de EEG (fabricante,
referencia, frecuencia de la red, descripción de la tarea). El conversor los copia dentro del
`_eeg.json` de cada pasada, y lo que se pase por la línea de comandos manda sobre ellos.
