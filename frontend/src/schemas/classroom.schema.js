import { z } from 'zod';

// Client-side validation mirrors the server's rules (apps/backend/src/app.js); the server remains the authority.
export const createClassroomSchema = z.object({
  name: z.string().trim().min(2, 'Classroom name must be at least 2 characters').max(80, 'Name must be 80 characters or less'),
  subject: z.string().trim().max(80, 'Subject must be 80 characters or less').optional()
});

export const joinClassroomSchema = z.object({
  code: z.string().trim().transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().min(6, 'The join code has 8 letters and numbers').max(8, 'The join code has 8 letters and numbers'))
});

export const createSessionSchema = z.object({
  title: z.string().trim().min(2, 'Lecture title must be at least 2 characters').max(100, 'Title must be 100 characters or less')
});

export const vocabSchema = z.object({
  heard: z.string().trim().min(1, 'Enter the word as it is misheard').max(60, 'Keep it under 60 characters'),
  replacement: z.string().trim().min(1, 'Enter the correct word').max(80, 'Keep it under 80 characters')
});
