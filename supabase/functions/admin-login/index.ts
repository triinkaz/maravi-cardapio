import { createHandler, readConfig } from './handler.mjs';

// No service-role/secret key is read. Supabase Auth verifies the password.
Deno.serve(createHandler(readConfig((name) => Deno.env.get(name))));
