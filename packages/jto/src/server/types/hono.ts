import { Context } from 'hono';

/**
 * Custom Hono context variables
 */
export type Variables = {
  requestId: string;
};

/**
 * Custom Hono bindings
 */
export type Bindings = {
  // Add any environment bindings here if needed
};

/**
 * Typed Hono context
 */
export type AppContext = Context<{
  Bindings: Bindings;
  Variables: Variables;
}>;

/**
 * App environment configuration
 */
export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
