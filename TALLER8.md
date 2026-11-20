# Taller 8: wallets, transacciones y control de acceso

## Descripción

Esta API de gestión de gastos usa Express y aplica Clean Architecture: rutas y controladores HTTP, casos de uso, entidades de dominio y repositorios de infraestructura. Los usuarios y monedas viven en MongoDB; categorías, transacciones, presupuestos, auditoría y wallets viven en MySQL.

## Requisitos y configuración

- Node.js 20 o superior y npm.
- MySQL 8 compatible con InnoDB y MongoDB.
- Copiar `envexample` a `.env` y completar `JWT_SECRET`, `MONGO_URI`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` y `MYSQL_DB`. El `.env` local no se versiona. No se incluyen credenciales en este repositorio.
- El registro público crea usuarios con rol `user`. Para habilitar el bonus, asigne `role: "admin"` a una cuenta confiable desde el entorno administrativo de MongoDB.

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

Ejecutar `npm test`. En esta entrega se ejecutaron 7 pruebas y las 7 pasaron. Cubren propiedad y validación de wallet, bloqueo de borrado si hay referencias, payload transaccional anterior sin wallet, wallet válida/inexistente/de otro usuario, privacidad del recibo y cadena HTTP de autenticación/rol (401, 403, admin). Son pruebas unitarias con repositorios sustitutos; no prueban conexión real, migración SQL ni operación contra Mongo/MySQL, que requieren servicios disponibles y credenciales.

Importe `docs/postman/Taller8.postman_collection.json` en Postman. Defina `baseUrl` como `http://localhost:3000`, ejecute registro/login y copie `token`; utilice el endpoint de categorías para obtener `categoryId`. Para probar rol admin, use la cuenta preconfigurada en MongoDB. Cree wallet, cree transacción pública con su id, pruebe recibo sin token, y cree otra transacción privada para verificar `403`. La colección guarda ids de respuesta cuando están disponibles.

Endpoints base adicionales: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET/POST /api/v1/transactions`, `PUT/DELETE /api/v1/transactions/:id`, `GET/POST /api/v1/currencies` y `GET /api/v1/categories`.

## Evidencias y límites del entorno

La evidencia verificable se genera al ejecutar `npm test` y está recogida en el informe de entrega. La migración solo debe correr contra la base local de desarrollo configurada. En el entorno de preparación no se proporcionaron claves de conexión ni servicios de base identificados; por tanto, no se ejecutó una migración ni se afirmó que el servidor conectara.

## Guion corto para la defensa

1. Mostrar que las wallets se guardan en MySQL con `userId` tomado del JWT.
2. Crear transacción sin wallet y luego con wallet; intentar asociar wallet ajena para demostrar validación de propiedad.
3. Abrir comprobante público sin token y comparar con un recibo privado (403); señalar que la migración protege datos antiguos con `isPrivate=true`.
4. Intentar registrar moneda sin token (401), como `user` (403) y como `admin` (201).
5. Explicar que rutas/controladores, casos de uso, entidades y repositorios mantienen responsabilidades separadas.

## Preguntas posibles

- **¿Por qué `walletId` puede ser nulo?** Para mantener compatibilidad y permitir registrar movimientos sin cuenta asociada.
- **¿Qué pasa al borrar una wallet usada?** Se responde 409 y se exige conservarla para no perder referencias históricas.
- **¿Cómo se mantiene privado un recibo antiguo?** La columna se agrega con `NOT NULL DEFAULT TRUE`.
- **¿Cómo se evita que cualquier usuario sea admin?** Registro fija el rol `user`; administración asigna `admin` fuera del endpoint público.
- **¿Por qué se separa el caso de uso del repositorio?** El caso de uso valida reglas del negocio y el repositorio conoce la persistencia concreta.
