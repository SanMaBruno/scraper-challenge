# Scraper OEFA — Resoluciones del Tribunal de Fiscalización Ambiental

Scraper en TypeScript para el [registro de resoluciones del TFA de OEFA](https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml).
Recorre toda la paginación, extrae los metadatos de cada resolución y descarga
los PDFs asociados.

El enunciado del desafío apunta al portal del Poder Judicial
(`jurisprudencia.pj.gob.pe`), que responde 403 fuera de Perú — lo comprobé
antes de decidir. Por eso desarrollé contra el sitio alternativo de OEFA que
el propio enunciado ofrece para trabajar sin VPN. Es el mismo tipo de
aplicación: JSF/PrimeFaces sin API, con estado de sesión en el servidor.
Portarlo al del Poder Judicial es cambiar la URL y los ids del formulario
(están centralizados en un solo objeto en `OefaClient.ts`), no la arquitectura.

Está resuelto sin automatización de navegador, como pide el desafío: solo
peticiones HTTP con `axios` y parsing con `cheerio`.

## El problema real: no hay API, hay que hablar JSF

Lo que hace largo este scraper no es "leer una tabla HTML", es que el sitio no
tiene endpoints. Es una aplicación JSF (JavaServer Faces) con PrimeFaces, donde
cada interacción del usuario dispara un POST que lleva de vuelta un token de
estado (`ViewState`) que el servidor generó en la respuesta anterior. Si le
mandas un ViewState viejo, la sesión se rompe.

Antes de escribir código miré el tráfico real del sitio con las herramientas de
red del navegador y con `curl` a mano. De ahí salió todo:

- El HTML inicial trae el `ViewState` en un input oculto y el `jsessionid`
  incrustado en el `action` del formulario.
- El botón "Buscar" no recarga la página: dispara un POST AJAX parcial y la
  respuesta es un XML (`partial-response`) que trae la grilla y, escondido en
  un `<script>`, el total de registros (`rowCount:1753`, con 10 por página son
  176 páginas).
- La paginación es otro POST AJAX contra el componente de la tabla
  (`dt_first`, `dt_rows`). Acá me encontré con la primera sorpresa: la
  respuesta de búsqueda trae la grilla completa, pero la respuesta de
  paginación trae solo las filas `<tr>` sueltas, sin el `<tbody>` que las
  envuelve. La primera versión del parser asumía que siempre había un
  `<tbody>` y en la página 2 me devolvía cero documentos. Quedó como test de
  regresión.
- La descarga del PDF es un POST de formulario normal (no AJAX). Cada fila
  tiene un `onclick` con `mojarra.jsfcljs(...)` que lleva el uuid del documento
  y el id del componente que dispara la descarga. Con esos dos datos se
  reproduce el POST y el servidor devuelve el binario.

## Cómo está armado

Separé el código en capas, con el núcleo dependiendo de interfaces y no de
librerías concretas:

```
src/
├── main.ts                 punto de entrada, arma e inyecta todo
├── config/                 configuración (env vars + flags de CLI)
├── core/
│   ├── domain/              la entidad JurisprudenceDocument
│   └── ports/                interfaces: IHttpClient, ILogger, IDocumentRepository, IFileStorage
├── infrastructure/          implementaciones concretas de esos puertos
│   ├── http/                  cliente HTTP con axios
│   ├── logging/                logger a consola
│   └── storage/                 JSON, CSV, filesystem
├── scraper/                 la lógica específica de OEFA
│   ├── JsfState.ts             guarda el ViewState/jsessionid vigente
│   ├── OefaParser.ts           HTML/XML -> objetos de dominio (cheerio, sin red)
│   ├── OefaClient.ts           arma los POST/GET que espera JSF
│   ├── PdfDownloader.ts        descarga un PDF con reintentos
│   ├── FailedDownloadRetrier.ts consume la cola de descargas fallidas
│   └── OefaScraper.ts          orquesta el recorrido completo
└── shared/                  retry con backoff, errores tipados, sleep
```

No es capricho de "arquitectura por la arquitectura". El `OefaParser` no toca
la red, así que se puede testear con un HTML guardado sin depender del sitio
en vivo. El scraper no conoce `axios`, conoce `IHttpClient`, así que en los
tests de `PdfDownloader` reemplazo el cliente real por uno que simula un 429 a
propósito, sin esperar a que el servidor me tire uno de verdad. Y si algún día
hay que sacar los metadatos también en CSV, es una clase nueva
(`CsvDocumentRepository`) sin tocar el scraper.

Los ids de los componentes JSF (`j_idt21`, `j_idt63`, etc.) están centralizados
en un solo objeto dentro de `OefaClient`. Son el punto más frágil de todo esto:
si OEFA redespliega la app, pueden cambiar, y prefiero tener ese riesgo en un
solo lugar rotulado en vez de esparcido como strings mágicos por el código.

## El error 429

El sitio corta con HTTP 429 si le pegas muy seguido. La solución tiene tres
partes:

Primero, el cliente HTTP convierte cualquier 429 en un error tipado
(`RateLimitError`) que lleva el `Retry-After` si el servidor lo mandó. Segundo,
`withRetry` reintenta con backoff exponencial (el doble de espera en cada
intento, con un tope y algo de aleatoriedad para no pegarle al servidor todos
los reintentos al mismo tiempo). Si vino `Retry-After`, se respeta eso por
sobre el cálculo. Tercero, si un documento agota los reintentos no se aborta
todo el proceso: se anota en `failed-downloads.jsonl` con el motivo y se sigue
con el siguiente. Un PDF terco no puede tirar abajo la descarga de los otros
1750.

Para no dejar esa cola de fallos como una promesa vacía, agregué un modo
`--retry-failed` que la consume: abre una sesión nueva, navega hasta la página
donde estaba cada documento y lo vuelve a buscar por su uuid (el id del
componente de la sesión anterior ya no sirve, hay que reubicar el documento con
datos frescos). Lo que se recupera sale de la cola, lo que vuelve a fallar se
re-anota solo.

También hay delay configurable entre peticiones. No se trata de sacarle el
jugo al servidor, es un sitio público del estado peruano, la idea es convivir.

## Instalación y uso

Necesitas Node 18 o superior.

```bash
git clone https://github.com/SanMaBruno/scraper-challenge.git
cd scraper-challenge
npm install
```

Para probar rápido sin esperar las 176 páginas:

```bash
npm run scrape:sample
```

Esto corre 2 páginas y descarga 3 PDFs. Tarda menos de un minuto y ya te deja
ver que la sesión JSF, la paginación y la descarga funcionan de punta a punta.

Para la corrida completa:

```bash
npm run scrape
```

Y para reintentar lo que haya quedado en la cola de fallos:

```bash
npm run scrape:retry-failed
```

Todo se puede ajustar con flags o variables de entorno:

```bash
npx ts-node src/main.ts --max-pages=5 --max-pdfs=10 --delay=2000 --format=csv
```

| Flag | Env var | Default | Qué hace |
|---|---|---|---|
| `--max-pages=N` | `MAX_PAGES` | 0 (todas) | páginas a recorrer |
| `--max-pdfs=N` | `MAX_PDFS` | 0 (todos) | tope de PDFs a descargar |
| `--format=X` | `OUTPUT_FORMAT` | json | `json`, `csv` o `both` |
| `--delay=MS` | `REQUEST_DELAY_MS` | 1500 | espera entre peticiones |
| `--retry-failed` | — | off | solo reintenta la cola de fallos |
| | `OUTPUT_DIR` | `./data` | carpeta de salida |
| | `RETRY_MAX_ATTEMPTS` | 5 | reintentos ante 429 |
| | `DEBUG=1` | — | logs de depuración |

La salida queda en `./data/`: `documents.json` (o `.csv`) con los metadatos,
`pdfs/` con los PDFs, y `failed-downloads.jsonl` con lo que haya fallado. Si
reejecutás, los PDFs ya descargados se saltan, así que se puede cortar y
retomar sin perder nada.

## Tests

```bash
npm test
```

29 tests, corren en un par de segundos porque no tocan la red. El parser se
prueba contra respuestas reales del sitio que guardé como fixtures (las mismas
que usé para reversear el protocolo), incluyendo el caso de la paginación sin
`tbody` que me hizo perder una tarde. La descarga y el reintento de fallos se
prueban con un cliente HTTP falso que simula el 429 cuando yo quiero, no
cuando el servidor decide dármelo.

Corren también en GitHub Actions con cada push (Node 18 y 20).

## Dónde está cada requisito del desafío

Para no hacer buscar al que evalúa:

| Requisito | Dónde |
|---|---|
| Navegación y paginación completa | `OefaScraper.run()` + `OefaClient.fetchPage()` |
| Extracción de todos los campos | `OefaParser.parseRows()` |
| Descarga de PDFs con nombre descriptivo | `PdfDownloader` + `buildPdfFileName()` |
| Detección del 429 | `AxiosHttpClient.handle()` → `RateLimitError` |
| Backoff exponencial | `shared/retry.ts` (`withRetry`, respeta `Retry-After`) |
| Continuar si el error persiste | `PdfDownloader.download()` nunca lanza: registra y sigue |
| Registro de fallidos para reintentar | `failed-downloads.jsonl` + modo `--retry-failed` |
| Sin browser automation | solo `axios` y `cheerio`, no hay más dependencias |

## Qué le falta

Para ser honesto sobre las decisiones que tomé sabiendo que quedaban cabos
sueltos:

Las descargas son secuenciales, no en paralelo. Con concurrencia se terminaría
antes, pero también se pega más fuerte al rate limiting; para un sitio público
del estado me pareció mejor priorizar que no se caiga.

Si la sesión JSF expira en medio de una corrida muy larga, el scraper lo
detecta y avisa, pero no renegocia la sesión sola todavía — hay que
reejecutar, y gracias a que se salta los PDFs ya descargados no se pierde el
trabajo hecho.

Los ids `j_idt` del formulario están hardcodeados (centralizados, pero
hardcodeados). Si el sitio cambia su HTML, hay que ir a mirar de nuevo.

---

Bruno San Martín Navarro
[github.com/SanMaBruno](https://github.com/SanMaBruno) ·
[linkedin.com/in/sanmabruno](https://www.linkedin.com/in/sanmabruno)

Licencia MIT.
