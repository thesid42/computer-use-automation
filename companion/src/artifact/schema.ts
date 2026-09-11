import { z } from 'zod';

export const riskClassSchema = z.enum(['READ_ONLY', 'REVERSIBLE_WRITE', 'IRREVERSIBLE_WRITE']);
export const actionKindSchema = z.enum(['click', 'fill', 'selectOption', 'wait', 'extract', 'finish', 'requestHuman', 'clickPoint']);

const locatorSchema = z.object({
  ref: z.string().regex(/^control-[A-Za-z0-9_-]+$/).optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
  relativeText: z.string().optional(),
  framePath: z.array(z.string()).optional(),
  frameUrl: z.string().url().optional(),
  fingerprint: z.string().optional(),
  visualAnchor: z.string().optional(),
  offset: z.object({ x: z.number(), y: z.number() }).optional()
}).refine((value) => Object.keys(value).length > 0, 'at least one locator strategy is required');

const targetSchema = z.object({
  strategies: z.array(locatorSchema).min(1),
  expectedRole: z.string().optional(),
  expectedName: z.string().optional()
});

const inputReferenceSchema = z.object({ fromInput: z.string().min(1) });
const inputSensitivitySchema = z.enum(['member_identifier', 'date']);
export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), id: z.string(), target: targetSchema, risk: riskClassSchema.default('READ_ONLY') }),
  z.object({ kind: z.literal('fill'), id: z.string(), target: targetSchema, value: z.union([z.string(), inputReferenceSchema]), risk: riskClassSchema.default('READ_ONLY') }),
  z.object({ kind: z.literal('selectOption'), id: z.string(), target: targetSchema, option: z.union([z.string(), inputReferenceSchema]), risk: riskClassSchema.default('READ_ONLY') }),
  z.object({ kind: z.literal('wait'), id: z.string(), condition: z.string(), timeoutMs: z.number().int().positive().max(120000) }),
  z.object({ kind: z.literal('extract'), id: z.string(), target: targetSchema, output: z.string(), parseAs: z.enum(['text', 'money', 'string']) }),
  z.object({ kind: z.literal('finish'), id: z.string(), outputs: z.array(z.string()), checkpoint: z.string() }),
  z.object({ kind: z.literal('requestHuman'), id: z.string(), reason: z.string().min(1) }),
  z.object({ kind: z.literal('clickPoint'), id: z.string(), x: z.number(), y: z.number(), risk: riskClassSchema.default('READ_ONLY') })
]);

export const capabilitySchema = z.object({
  schemaVersion: z.literal(1),
  capabilityId: z.string().regex(/^[a-z0-9.-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().min(1),
  intentSignature: z.object({
    intent: z.string(), requiredConcepts: z.array(z.string()), phrases: z.array(z.string())
  }),
  inputs: z.array(z.object({
    name: z.string(), type: z.literal('string'), sensitivity: inputSensitivitySchema,
    validation: z.object({ minLength: z.number().int().nonnegative(), maxLength: z.number().int().positive(), format: z.enum(['iso_date']).optional() })
  })),
  outputs: z.array(z.object({ name: z.string(), type: z.enum(['money', 'string']), currency: z.string().optional() })),
  businessOutcomes: z.array(z.string()),
  risk: riskClassSchema,
  policyProfile: z.object({
    allowedOrigins: z.array(z.string()), allowedRoutes: z.array(z.string()),
    allowedActionKinds: z.array(actionKindSchema), maxRisk: riskClassSchema, controlOwner: z.literal('automation'),
    blockedTargetNamePatterns: z.array(z.string()).optional()
  }),
  actions: z.array(actionSchema),
  preconditions: z.array(z.string()),
  postconditions: z.array(z.string()),
  waits: z.object({ defaultTimeoutMs: z.number().int().positive(), retries: z.number().int().nonnegative().max(3) }),
  extraction: z.array(z.object({ output: z.string(), actionId: z.string(), parseAs: z.enum(['text', 'money', 'string']) })),
  finalCheckpoint: z.string().min(1),
  compatibility: z.object({ applicationFamily: z.string(), targetProfileId: z.string() })
});

export type CapabilityArtifact = z.infer<typeof capabilitySchema>;
export type ArtifactAction = z.infer<typeof actionSchema>;
export type TargetSpec = z.infer<typeof targetSchema>;
