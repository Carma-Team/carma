/**
 * @file transportMode.ts
 * @owner Dan (CPO) — fraud & transport-mode detection
 * @brief The transport modes FraudDetector classifies a session into.
 * Lives in CARMA rather than in driving-sdk: "was this a train" is this product's question,
 * and a sensor library handed to another app has no use for the vocabulary.
 */

export enum TransportMode {
  UNKNOWN = 'UNKNOWN',  // not yet classified (Phase 2 populates this)
  CAR     = 'CAR',
  TRAIN   = 'TRAIN',
  BUS     = 'BUS',      // Phase 2 classifier (reserved — FraudDetector emits UNKNOWN until implemented)
}
