import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import publicRouter from './public.route.js';
import { publicService } from './public.service.js';
import { errorHandler } from '../../middleware/errorHandler.js';

// Mock the service so we don't hit the DB
vi.mock('./public.service.js', () => {
  return {
    publicService: {
      logActivityEvent: vi.fn().mockResolvedValue({ id: 'mock-event-id' }),
      getAssessmentInfo: vi.fn(),
      startSession: vi.fn(),
      getSessionQuestions: vi.fn(),
      submitAttempt: vi.fn(),
      runCode: vi.fn(),
      finishSession: vi.fn()
    }
  };
});

const app = express();
app.use(express.json());
app.use('/api/public', publicRouter);
app.use(errorHandler);

const mockSessionId = 'session-123';
const mockCandidateId = 'candidate-123';
const mockAssessmentId = 'assessment-123';

// Generate a valid token
const validToken = jwt.sign(
  { sessionId: mockSessionId, candidateId: mockCandidateId, assessmentId: mockAssessmentId },
  env.JWT_SECRET || 'test-secret'
);

describe('Public Controller - WebCam Integrity Events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure env secret is set for tests if missing
    if (!env.JWT_SECRET) {
      env.JWT_SECRET = 'test-secret';
    }
  });

  const validWebcamEvents = [
    'CAMERA_STARTED',
    'CAMERA_PERMISSION_DENIED',
    'CAMERA_ERROR',
    'CAMERA_DISCONNECTED',
    'FACE_NOT_DETECTED',
    'FACE_DETECTED',
    'MULTIPLE_FACES_DETECTED'
  ];

  it.each(validWebcamEvents)('should successfully log %s event and persist metadata', async (eventType) => {
    const response = await request(app)
      .post('/api/public/sessions/events')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        eventType,
        details: { faceCount: 1, reason: 'test' }
      });

    // The current backend does not know these events yet, so it will fail 400 until implemented
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(publicService.logActivityEvent).toHaveBeenCalledWith(
      mockSessionId, 
      eventType, 
      { faceCount: 1, reason: 'test' }
    );
  });

  it('should reject an invalid event type with 400', async () => {
    const response = await request(app)
      .post('/api/public/sessions/events')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        eventType: 'INVALID_EVENT_XYZ'
      });

    expect(response.status).toBe(400);
    // Zod error should be handled by errorHandler
  });

  it('should reject request without session token (401)', async () => {
    const response = await request(app)
      .post('/api/public/sessions/events')
      .send({
        eventType: 'CAMERA_STARTED'
      });

    expect(response.status).toBe(401);
    expect(publicService.logActivityEvent).not.toHaveBeenCalled();
  });

  it('should reject request with invalid session token (401)', async () => {
    const response = await request(app)
      .post('/api/public/sessions/events')
      .set('Authorization', `Bearer invalid-token`)
      .send({
        eventType: 'CAMERA_STARTED'
      });

    expect(response.status).toBe(401);
    expect(publicService.logActivityEvent).not.toHaveBeenCalled();
  });
});
