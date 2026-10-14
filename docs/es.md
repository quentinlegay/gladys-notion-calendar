# Notion Calendar

Lleva a Gladys las bases de datos de Notion que muestras en
[Notion Calendar](https://www.notion.com/product/calendar): planificación del
equipo, tareas con fecha límite, calendario editorial, viajes… Los eventos
aparecen en la vista de calendario de Gladys, activan el recordatorio «Un
evento se acerca» y alimentan al asistente y dos widgets del panel.

## Funcionamiento

```
Bases de datos de Notion (propiedad fecha)  ──API de Notion──>  esta integración  ──>  calendarios de Gladys
```

Notion Calendar no tiene API pública: muestra las bases de datos de Notion
que tienen una propiedad de **fecha**. La integración lee esas mismas bases a
través de la API de Notion y luego:

- cada base de datos (fuente de datos) con una propiedad de fecha se convierte
  en un **calendario** de Gladys, con el nombre de la base;
- cada página con fecha se convierte en un **evento**: su título, su fecha (de
  todo el día o con hora), su enlace de Notion y, cuando la base tiene una
  propiedad de texto `Location` / `Lugar` / `Ubicación` / `Lieu`, su lugar.

La sincronización va de Notion a Gladys, cada 15 minutos por defecto. Una
página eliminada, o cuya fecha se ha borrado, sale de Gladys en la siguiente
sincronización. Solo la acción de escena **Añadir un evento de Notion**
escribe en Notion.

Las reuniones de Google u Outlook que Notion Calendar también muestra no pasan
por Notion: usa para ellas la integración CalDAV o Google de Gladys.

## Configuración

### 1. Crea una integración de Notion (una vez por persona)

1. Abre [Mis integraciones de Notion](https://www.notion.so/profile/integrations)
   y crea una **integración interna** en tu espacio de trabajo.
2. Capacidades: basta con **Leer contenido**. Marca también **Insertar
   contenido** para usar la acción de escena «Añadir un evento de Notion».
3. Copia el **secreto** de la integración (empieza por `ntn_`).
4. En cada base de datos que quieras sincronizar, abre el menú **•••** →
   **Conexiones** y añade tu integración. Una base de datos que no está
   compartida permanece invisible.

### 2. Ajustes de la integración (administrador)

En la pestaña **Configuración**:

| Ajuste                            | Por defecto | Función                                                 |
| --------------------------------- | ----------- | ------------------------------------------------------- |
| Intervalo de sincronización       | 15 min      | Frecuencia de lectura de Notion (5 minutos como mínimo) |
| Días conservados en el pasado     | 30          | Los eventos más antiguos se eliminan de Gladys          |
| Días sincronizados por adelantado | 90          | Horizonte de la vista, los recordatorios y los widgets  |

### 3. Activa «Mis calendarios» (cada usuario)

Los calendarios son datos personales: cada usuario de Gladys activa la
integración para sí mismo, con su propio secreto de Notion, en el bloque
**Mis calendarios** de la página de la integración.

- **Secreto de la integración de Notion**: el secreto copiado en el paso 1.
- **Bases de datos (opcional)**: enlaces o identificadores de las bases que
  sincronizar, separados por comas. Déjalo vacío para sincronizar todas las
  bases compartidas con la integración.
- **Propiedad de fecha (opcional)**: nombre de la propiedad que usar cuando
  una base tiene varias (p. ej. `Vencimiento`). Vacío: la primera propiedad de
  fecha de la base.

El botón **Probar las cuentas de Notion** de la pestaña Configuración indica,
para cada usuario, cuántas bases con fecha puede leer su secreto.

### 4. Comparte los calendarios importantes

Un calendario sincronizado empieza siendo **privado**: solo lo ve su
propietario. Compártelo con el hogar (interruptor **Compartido**) para
mostrarlo en los paneles, en las escenas y a los demás miembros. El
interruptor **Sincronizado** pone en pausa un calendario sin eliminarlo.

## Escenas

### Disparadores

| Disparador                            | Cuándo                                                                         | Variables                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| **Evento de Notion añadido**          | Aparece una página con fecha en un calendario de Notion compartido             | `calendar`, `name`, `start`, `all_day`, `url` |
| **Error de sincronización de Notion** | Una cuenta deja de sincronizarse (token revocado, base de datos no compartida) | `user`, `error`                               |

El disparador «Evento de Notion añadido» se puede filtrar por el **nombre del
calendario** (el nombre de la base de datos de Notion). No se activa en la
primera sincronización de una cuenta ni para los eventos creados por la acción
de escena de abajo.

El disparador integrado de Gladys **Un evento se acerca** también funciona
con los calendarios de Notion compartidos.

### Acciones

| Acción                                    | Campos                                 | Salidas                                                      |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| **Sincronizar los calendarios de Notion** | —                                      | `calendars`, `events`, `success`                             |
| **Añadir un evento de Notion**            | calendario, nombre, inicio, fin, lugar | `created`, `url`                                             |
| **Obtener el próximo evento de Notion**   | calendario (vacío: todos)              | `found`, `name`, `start`, `minutes_until`, `calendar`, `url` |

- **Inicio / fin**: una fecha (`2026-10-12`) para un evento de todo el día, o
  una fecha y hora con desfase horario (`2026-10-12T09:00:00+02:00`). Se
  aceptan variables de escena.
- Las acciones solo ven los calendarios **compartidos**.

Ejemplo: cada mañana a las 7, «Obtener el próximo evento de Notion» y, si
`found` es verdadero, hacer que el asistente anuncie `{{name}}`.

## Widgets

| Widget                | Contenido                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| **Agenda de Notion**  | Los próximos eventos (1 a 8), filtrables por calendario, con su enlace de Notion |
| **Resumen de Notion** | Eventos en 24 h y 7 días, tiempo hasta el próximo, estado de la sincronización   |

Ambos widgets ofrecen un botón **Sincronizar** y solo muestran los
calendarios compartidos (un panel puede estar en una pantalla pública).

## Solución de problemas

- **«Notion ha rechazado el token»**: el secreto se ha regenerado o la
  integración se ha eliminado. Pega el nuevo secreto en Mis calendarios.
- **«Una base de datos no está compartida»**: una base indicada en «Bases de
  datos» no está conectada a la integración (••• → Conexiones), o el enlace es
  incorrecto.
- **Una base de datos no aparece**: no tiene propiedad de fecha o no está
  compartida con la integración.
- **Un evento de más de 90 días que se solapa con el periodo** no se
  sincroniza: solo se leen las páginas que empiezan como mucho 90 días antes
  del periodo.
- Los registros de la integración (pestaña Supervisión) detallan cada
  sincronización; el secreto de Notion nunca aparece en ellos.

## Privacidad

Gladys guarda el secreto de Notion de cada usuario, no lo vuelve a mostrar en
la interfaz y solo lo envía a `api.notion.com`. La integración solo lee las
bases de datos que has compartido explícitamente con tu integración de
Notion.
