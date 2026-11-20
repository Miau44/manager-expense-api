# Taller 8: wallets, transacciones y control de acceso

## Descripción

Esta API de gestión de gastos usa Express y aplica Clean Architecture: rutas y controladores HTTP, casos de uso, entidades de dominio y repositorios de infraestructura. Los usuarios y monedas viven en MongoDB; categorías, transacciones, presupuestos, auditoría y wallets viven en MySQL.

## Requisitos y configuración

- Node.js 20 o superior y npm.
- MySQL 8 compatible con InnoDB y MongoDB.
- Copiar `envexample` a `.env` y completar `JWT_SECRET`, `MONGO_URI`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` y `MYSQL_DB`. El `.env` local no se versiona. No se incluyen credenciales en este repositorio.
- El registro público crea usuarios con rol `user`. Para habilitar el bonus, asigne `role: "admin"` a una cuenta confiable desde el entorno administrativo de MongoDB.
- En esta computadora, MySQL 8.4.3 de Laragon usa `localhost:3306`; MongoDB Community 8.0.30 se instaló en el perfil local y escucha solo en `127.0.0.1:27017`. MongoDB se ejecuta como proceso de usuario, no como servicio de Windows. Para iniciarlo después de reiniciar:

```powershell
$root = Join-Path $env:LOCALAPPDATA 'manager-expense-api'
$bin = Join-Path $root 'mongodb-server-8.0.30\mongodb-win32-x86_64-windows-8.0.30\bin\mongod.exe'
$data = Join-Path $root 'mongo-data'
$log = Join-Path $root 'mongod.log'
Start-Process -FilePath $bin -ArgumentList @('--dbpath', $data, '--bind_ip', '127.0.0.1', '--port', '27017', '--logpath', $log, '--logappend') -WindowStyle Hidden
```

Instalar y ejecutar:

```sh
npm ci
npm test
npm run dev
```

El servidor inicia en `PORT` (3000 por defecto), conecta a las dos bases y carga monedas/categorías iniciales. Al conectar MySQL se ejecuta una migración aditiva idempotente. También se puede ejecutar manualmente con `npm run migrate` una vez configurado el entorno local. No borra tablas ni recrea datos existentes. La migración agrega `walletId` nullable e `isPrivate` con valor predeterminado `true`, para que recibos históricos no se hagan públicos accidentalmente.

## Ejercicio 1: wallets

Se añadieron WalletEntity, WalletMySQLRepository, WalletService, WalletController y `wallet.routes.js`. La billetera pertenece al usuario autenticado; el id de propietario nunca se acepta desde el cuerpo. Se validan nombre, tipo (`CASH`, `BANK`, `CARD`, `OTHER`) y moneda ISO de tres letras.

Una wallet sin transacciones se elimina. Si está referenciada, el servidor responde `409 Conflict` y conserva la wallet; de este modo no se pierde el historial ni queda una asociación rota. Las consultas y borrados están limitados al propietario.

Endpoints (todos requieren Bearer JWT):

- `POST /api/v1/wallets` — crear.
- `GET /api/v1/wallets` — listar wallets del usuario.
- `DELETE /api/v1/wallets/:id` — eliminar si no tiene transacciones.

Ejemplo de creación:

```json
{"name":"Banco Nacional","type":"BANK","currency":"BOB","description":"Cuenta principal"}
```

## Ejercicio 2: relación opcional

Transaction acepta `walletId` opcional o `null`; al omitirlo conserva compatibilidad con clientes anteriores. Si se especifica, el caso de uso valida que exista y sea del usuario autenticado. El mismo control se aplica al actualizar con `PUT /api/v1/transactions/:id`; enviar `walletId: null` desvincula la transacción. `isPrivate` también puede indicarse al crear o actualizar y solo admite booleanos.

```json
{"type":"EXPENSE","amount":45.5,"currency":"BOB","date":"2026-11-19","categoryId":3,"walletId":1,"isPrivate":false,"description":"Almuerzo"}
```

Los ingresos/egresos siguen usando su categoría y el tipo de cambio de la fecha. Las tablas existentes no se recrean. La migración deja `walletId` en `NULL` y marca las operaciones históricas privadas.

## Ejercicio 3: comprobante público

`GET /api/v1/transactions/:id/public` está antes de las rutas dinámicas y no usa JWT. Devuelve `404` si no existe, `403` si es privado y `200` para una transacción pública. La respuesta contiene únicamente id, tipo, montos, moneda, descripción, fecha, categoría y wallet; omite propietario, correo, contraseña y tokens. La privacidad se activa por defecto.

Ejemplo de respuesta pública:

```json
{"id":12,"type":"EXPENSE","amount":"45.50","currency":"BOB","convertedAmount":"45.50","description":"Almuerzo","date":"2026-11-19","categoryId":3,"walletId":1}
```

Las demás rutas de transacciones mantienen su middleware JWT.

## Ejercicio 4 bonus: roles

La escritura `POST /api/v1/currencies` pasa primero por `authMiddleware` y luego por el `roleMiddleware(["admin"])` existente. Sin token responde `401`; un usuario `user`, `403`; un admin autorizado puede registrar o actualizar el tipo de cambio en MongoDB. La consulta de monedas no se cambió. El registro público ignora un `role` enviado por el cliente y crea cuentas `user`, cerrando la elevación de privilegios accidental.

## Clean Architecture y cambios principales

- Dominio: `src/domain/entities/wallet.entity.js`, ampliación de `transaction.entity.js`.
- Aplicación: `src/application/use-cases/wallet.service.js` y validaciones de `transaction.service.js`.
- Infraestructura: repositorio MySQL de wallets, columnas opcionales en Transaction y migración `src/infrastructure/database/mysql/migrations/001-taller8.js`.
- Presentación: controlador/rutas de wallets; ruta pública de recibo; protección por rol de monedas.
- Inicialización: `src/app.js`, conexión MySQL (ya no usa `sync alter`; la evolución es explícita) y guardia de rol al registrarse.
- Verificaciones: `test/taller8.test.js`; colección importable `docs/postman/Taller8.postman_collection.json`.

Los controladores traducen HTTP, los casos de uso validan reglas del negocio y los repositorios encapsulan Sequelize. La migración es infraestructura y no reemplaza las entidades/casos de uso.

## Pruebas y Postman

Ejecutar `npm test` para las pruebas unitarias. En la verificación final, las 7 pruebas pasaron. Para probar endpoints reales, iniciar primero el servidor con `npm run dev` y luego ejecutar `npm run test:integration`. Ese verificador solo admite `localhost`/`127.0.0.1` y la base `bd_gastos`; genera credenciales temporales, crea un admin directamente en la base local (sin exponer una ruta pública), comprueba MySQL/MongoDB, guarda el resultado sin tokens ni contraseñas en `docs/evidencias/verificacion-local.json` y limpia las cuentas/filas temporales que él mismo creó. Si un correo de prueba ya existe, se detiene sin borrarlo.

Resultado real de esta ejecución: MySQL 8.4.3 y MongoDB 8.0.30 conectados; `npm run migrate` completó; 31 verificaciones HTTP pasaron. Incluyeron `health` y Swagger (200), wallets (201/200/403/409), transacciones (201/400/200), recibos (200/403/404), protección JWT (401/200) y monedas (401 sin token, 403 user, 201 admin). Se observaron 2 wallets y 3 transacciones persistidas en MySQL antes de limpiar datos de prueba; la moneda temporal se encontró en MongoDB y luego se retiró. La relación `walletId` es nullable, `isPrivate` es `NOT NULL DEFAULT 1` y la FK tiene `ON DELETE RESTRICT`.

Importe `docs/postman/Taller8.postman_collection.json` en Postman. Defina `baseUrl` como `http://localhost:3000`, ejecute registro/login y copie `token`; utilice el endpoint de categorías para obtener `categoryId`. Para probar rol admin, use la cuenta preconfigurada en MongoDB. Cree wallet, cree transacción pública con su id, pruebe recibo sin token, y cree otra transacción privada para verificar `403`. La colección guarda ids de respuesta cuando están disponibles.

Endpoints base adicionales: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET/POST /api/v1/transactions`, `PUT/DELETE /api/v1/transactions/:id`, `GET/POST /api/v1/currencies` y `GET /api/v1/categories`.

## Evidencias y estado de base de datos

- [Informe JSON de la prueba HTTP y persistencia](docs/evidencias/verificacion-local.json): versiones, estado de cada solicitud, esquema y claves de respuesta permitidas; no incluye JWT, contraseñas, emails ni identificadores de usuarios.
- `docs/evidencias/verificacion-local.json` se genera con `npm run test:integration`.
- MySQL: se creó `bd_gastos` porque no existía; estaba vacía antes de la inicialización. La migración se ejecutó al iniciar la API y nuevamente con `npm run migrate`, comprobando que fuera idempotente. No se eliminaron ni modificaron otras bases de Laragon.
- MongoDB corre localmente enlazado solo a loopback, con datos en `%LOCALAPPDATA%\manager-expense-api\mongo-data`; no se configuró como servicio global ni se usó un servicio de pago.
- Las pruebas de integración limpian únicamente los usuarios y filas temporales que generan. Las categorías y monedas semilla se mantienen para ejecutar la aplicación.

## Guion corto para la defensa

1. Ejecutar `npm run dev`, mostrar health/Swagger y enseñar en el informe que ambas bases conectan.
2. Mostrar que las wallets se guardan en MySQL con `userId` tomado del JWT.
3. Crear transacción sin wallet y luego con wallet; intentar asociar wallet ajena para demostrar validación de propiedad.
4. Abrir comprobante público sin token y comparar con un recibo privado (403); señalar que la migración protege datos antiguos con `isPrivate=true`.
5. Intentar registrar moneda sin token (401), como `user` (403) y como `admin` (201).
6. Explicar que rutas/controladores, casos de uso, entidades y repositorios mantienen responsabilidades separadas.

Historial de desarrollo: `d097c16` wallets, `0e0da9d` transacciones y comprobantes, `d429d73` autorización, `afac6fa` documentación/colección/tests y `d6992c5` casos adicionales de tests. Las pruebas de integración y el informe local se añaden después de esos commits.

## Preguntas posibles

- **¿Por qué `walletId` puede ser nulo?** Para mantener compatibilidad y permitir registrar movimientos sin cuenta asociada.
- **¿Qué pasa al borrar una wallet usada?** Se responde 409 y se exige conservarla para no perder referencias históricas.
- **¿Cómo se mantiene privado un recibo antiguo?** La columna se agrega con `NOT NULL DEFAULT TRUE`.
- **¿Cómo se evita que cualquier usuario sea admin?** Registro fija el rol `user`; administración asigna `admin` fuera del endpoint público.
- **¿Por qué se separa el caso de uso del repositorio?** El caso de uso valida reglas del negocio y el repositorio conoce la persistencia concreta.
