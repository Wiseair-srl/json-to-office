import { Type, type Static } from '@sinclair/typebox';
export { BlockInvocationPropsSchema } from '@json-to-office/shared';
import { BlockInvocationPropsSchema } from '@json-to-office/shared';

export const GroupPropsSchema = Type.Object(
  {},
  { additionalProperties: false }
);
export type BlockProps = Static<typeof BlockInvocationPropsSchema>;
