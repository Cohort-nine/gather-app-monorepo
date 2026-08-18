// db/prisma.js throws at import time if DATABASE_URL is unset. Tests that
// don't mock the module (auth.test.js) still trigger that import, so give it
// a placeholder — nothing here ever actually connects.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/gather_test?schema=public";
