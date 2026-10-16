# SAT INTUR · Plan de noviembre 2026

Formulario en línea para que las 17 delegaciones registren su plan de capacitaciones de noviembre. Cada delegación guarda un único plan, puede actualizarlo desde el mismo navegador y la DDT puede ver el consolidado desde **Acceso Admin**.

## Qué pide el formulario

Además de la información del ejemplo recibido, se incorporaron los datos necesarios para consolidar y dar seguimiento sin inventar información:

- Región, delegación, persona que registra, cargo, correo y teléfono.
- Tipo y tema de actividad.
- Fecha principal y fechas adicionales para cursos de varios días, sin duplicar la capacitación.
- Horario, municipio, lugar y modalidad.
- Institución que imparte, instituciones/actores participantes y responsable.
- Facilitador/a cuando la institución que imparte es INTUR.
- Proyección de participantes y observaciones.

La proyección es únicamente planificación: no se presenta como asistencia real ni como actividad ejecutada.

## Cancelaciones y consolidado

Una capacitación ya registrada puede cancelarse desde el plan territorial o desde **Acceso Admin**. El sistema exige un motivo y conserva la capacitación original junto con el estado `CANCELADA`, fecha y persona que registró la cancelación en el mismo arreglo JSONB del plan. No elimina la fila ni la actividad, y el historial administrativo permite filtrar y descargar un informe Word.

Las capacitaciones canceladas (y los borradores de actividad) no se incluyen en los conteos vigentes ni en las exportaciones oficiales Word/Excel. El Administrador también puede agregar una capacitación al plan existente de una delegación sin reemplazar las demás actividades. Las escrituras usan comparación de `updated_at`; si otra persona actualiza el plan al mismo tiempo, la operación se rechaza y se solicita actualizar antes de reintentar.

No se requiere cambio de esquema ni ejecutar una migración en Supabase: estos metadatos viven dentro del campo `activities` JSONB y las reglas RLS existentes siguen limitando el acceso a cada fila.

## Guardado en línea configurado

GitHub Pages aloja páginas estáticas: no puede guardar los planes de varias delegaciones por sí solo. Esta carpeta usa Supabase como almacenamiento central, con políticas de acceso por fila (RLS).

El proyecto ya está conectado a Supabase mediante su URL y su **Publishable key**. La tabla, las políticas RLS y el usuario administrativo también están creados. La conexión y el acceso a la consola Admin fueron comprobados el 12 de octubre de 2026.

Los pasos siguientes solo son necesarios si en el futuro se migra a otro proyecto de Supabase:

1. Cree un proyecto nuevo en Supabase.
2. En **SQL Editor**, pegue y ejecute el contenido completo de `supabase-setup.sql`.
3. En **Authentication > Users**, cree el usuario administrativo:
   - Correo: `ddt36@intur.local`
   - Contraseña: use la contraseña administrativa que usted definió para este proyecto.
4. En **Project Settings > API**, copie el **Project URL** y la **Publishable key**.
5. Abra `config.js` y complete únicamente estas dos líneas:

```js
supabaseUrl: 'https://SU-PROYECTO.supabase.co',
publishableKey: 'su_publishable_key'
```

No pegue una clave `secret`, `service_role` ni la contraseña en ningún archivo. La publishable key puede estar en una página pública; las políticas RLS del archivo SQL limitan los registros que puede ver o editar cada persona.

El nombre de usuario visible para la consola es `DDT36`. El formulario lo traduce internamente al correo administrativo anterior para iniciar sesión de manera segura mediante Supabase Auth.

## Probar antes de publicar

1. Abra `index.html` en el navegador o sirva la carpeta con un servidor local.
2. Complete una actividad de prueba, marque la confirmación y use **Guardar borrador**.
3. Verifique que al actualizar el navegador el borrador siga disponible.
4. Use **Acceso Admin**, inicie sesión con `DDT36` y compruebe que aparezca la delegación, quien la llenó, sus datos de contacto y las actividades.
5. Si la misma delegación intenta crear otro plan desde otro navegador, el sistema evita duplicarlo. Para continuar la edición desde otro equipo, la DDT debe recuperar o registrar el plan con esa delegación.

## Publicar en GitHub Pages

1. Cree un repositorio nuevo en GitHub.
2. Suba el contenido de esta carpeta, incluyendo `index.html`, `styles.css`, `app.js`, `config.js` y `supabase-setup.sql`.
3. En el repositorio, abra **Settings > Pages**.
4. Seleccione **Deploy from a branch**, elija la rama `main` y la carpeta `/(root)`; guarde.
5. GitHub mostrará la URL pública. Antes de compartirla, confirme que `config.js` ya contiene la URL y publishable key correctas.

## Respaldo

`SAT_Noviembre_Delegaciones_v4_Guardar_RESPALDO.html` es una copia sin modificar del archivo inicial entregado.

## Limitación importante

El navegador conserva un token de edición local para que la delegación pueda actualizar su propio registro. Si borran los datos del navegador o cambian de equipo, no deben crear un segundo plan: deben solicitar a la DDT la recuperación del acceso.
