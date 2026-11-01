import { config } from "zod";

// Zod tests whether it can compile validators with eval, which the Content-Security-Policy refuses.
// It runs before the app's own code, so no schema ever makes the attempt.
config({ jitless: true });
