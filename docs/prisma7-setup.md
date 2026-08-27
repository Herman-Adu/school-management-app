# Prisma 7 Setup Guide (Next.js 14 + TypeScript + Docker)

This document covers the full setup of Prisma 7 in a Next.js 14 project, including all known issues and their fixes.

---

## 1. Install Dependencies

```bash
npm install @prisma/client @prisma/adapter-pg pg dotenv
npm install --save-dev prisma tsx
```

> **Note:** `ts-node` has ESM compatibility issues with Prisma 7 when `"type": "module"` is set. Use `tsx` instead.

---

## 2. Configure `tsconfig.json`

Update the following compiler options:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2023",
    "strict": true,
    "esModuleInterop": true
  }
}
```

> **Issue:** Prisma docs suggest adding `"ignoreDeprecations": "6.0"` but Next.js 14's type checker rejects this value. **Do not add it.**

---

## 3. Enable ESM in `package.json`

```json
{
  "type": "module"
}
```

> **Warning:** This affects how config files and seed scripts are resolved. See the seed section below for the workaround.

---

## 4. Configure `prisma.config.ts`

In Prisma 7, the database connection URL is **no longer set in `schema.prisma`**. It lives in `prisma.config.ts`:

```ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
```

> **Issue:** Adding `url = env("DATABASE_URL")` to `schema.prisma` causes this error:
> `The datasource property 'url' is no longer supported in schema files.`
> The `datasource` block in `schema.prisma` should only contain `provider`:

```prisma
datasource db {
  provider = "postgresql"
}
```

---

## 5. Configure `schema.prisma`

Set the generator output to a custom path so the client is generated inside the project (required for Prisma 7):

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

---

## 6. Set Up `.env`

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:PORT/DATABASE"
```

---

## 7. Docker — PostgreSQL with Persistent Volume

Use Docker Compose so data survives reboots. Create `docker-compose.yml` at the project root:

```yaml
services:
  postgres:
    image: postgres:latest
    container_name: school
    restart: unless-stopped
    environment:
      POSTGRES_USER: youruser
      POSTGRES_PASSWORD: yourpassword
      POSTGRES_DB: yourdb
    ports:
      - "5435:5432"
    volumes:
      - school_data:/var/lib/postgresql

volumes:
  school_data:
```

> **Issue:** Postgres 18+ changed the data directory structure. The volume mount must be `/var/lib/postgresql` (not `/var/lib/postgresql/data`) or the container will fail to start with:
> `Error: in 18+, these Docker images are configured to store database data in a format which is compatible with "pg_ctlcluster"`

Start the container:

```bash
docker compose up -d
```

If switching from an old container with an incompatible volume:

```bash
docker compose down -v   # removes old volume
docker compose up -d
```

---

## 8. Run Migrations

```bash
npx prisma migrate dev --name init
```

---

## 9. Generate the Prisma Client

After every schema change or fresh clone:

```bash
npx prisma generate
```

This generates the client to `./generated/prisma`.

---

## 10. Import the Prisma Client

Because the output is a custom path, **do not import from `@prisma/client`**.

> **Issue:** `Module '"@prisma/client"' has no exported member 'PrismaClient'`  
> This is because Prisma 7 with a custom output no longer re-exports from `@prisma/client`.

### In `src/lib/prisma.ts`

```ts
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prismaClientSingleton = () => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
};

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma;
```

> **Issue:** `Expected 1 arguments, but got 0` when calling `new PrismaClient()`  
> Prisma 7 requires a driver adapter to be passed. Use `PrismaPg` from `@prisma/adapter-pg`.

> **Note on import path:** The path from `src/lib/` to `generated/prisma/client` requires going up **two** levels: `../../generated/prisma/client`. Going up only one (`../generated/prisma/client`) will fail.

---

## 11. Seed Script (`prisma/seed.ts`)

```ts
import { PrismaClient, UserSex } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // your seed data here
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

From `prisma/seed.ts`, the path goes up **one** level: `../generated/prisma/client`.

---

## 12. Run the Seed

```bash
npx prisma db seed
```

> **Issue:** `ts-node --compiler-options {"module":"CommonJS"}` fails with `ERR_MODULE_NOT_FOUND` when `"type": "module"` is set in `package.json`. The ESM/CJS boundary causes module resolution to break.  
> **Fix:** Use `tsx` instead. It handles ESM natively without the conflict.

---

## 13. Windows Port Reservation Issue (Prisma Studio)

On Windows with Hyper-V/WSL2/Docker Desktop, port ranges in the dynamic range (49152–65535) are reserved at boot. Prisma Studio's default port (51213) often falls inside a reserved block, causing:
`Error: Port 51213 is not available`

**Temporary fix** — use a different port:

```bash
npx prisma studio --port 5555
```

**Permanent fix** — run as Administrator and reboot:

```powershell
netsh int ipv4 set dynamicport tcp start=49152 num=1000
netsh int ipv4 set dynamicport udp start=49152 num=1000
```

This restricts the dynamic range to 49152–50151, keeping higher ports free from system reservations.

---

## Summary of Key Differences from Prisma 5/6

| Feature                  | Old behaviour                                  | Prisma 7                                 |
| ------------------------ | ---------------------------------------------- | ---------------------------------------- |
| Connection URL           | `url = env("DATABASE_URL")` in `schema.prisma` | Configured in `prisma.config.ts`         |
| Client import            | `from "@prisma/client"`                        | `from "../generated/prisma/client"`      |
| PrismaClient constructor | `new PrismaClient()`                           | `new PrismaClient({ adapter })` required |
| Seed config              | `prisma.seed` in `package.json`                | `migrations.seed` in `prisma.config.ts`  |
| Seed runner              | `ts-node`                                      | `tsx` (avoids ESM/CJS conflicts)         |
