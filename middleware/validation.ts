import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constant';
import rateLimit from 'express-rate-limit';

// Validation schemas
export const schemas = {
  register: Joi.object({
    username: Joi.string().min(3).max(30).required().messages({
      'string.min': 'Username must be at least 3 characters',
      'string.max': 'Username cannot exceed 30 characters',
      'any.required': 'Username is required',
    }),
    email: Joi.string().email().required().messages({
      'string.email': 'Please enter a valid email',
      'any.required': 'Email is required',
    }),
    password: Joi.string().min(6).required().messages({
      'string.min': 'Password must be at least 6 characters',
      'any.required': 'Password is required',
    }),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  message: Joi.object({
    conversationId: Joi.string().required(),
    content: Joi.string().max(1000).required(),
    type: Joi.string().valid('text', 'image', 'file').default('text'),
    replyTo: Joi.string().optional(),
  }),

  conversation: Joi.object({
    type: Joi.string().valid('direct', 'group').required(),
    participants: Joi.array().items(Joi.string()).min(1).required(),
    name: Joi.string().max(50).when('type', {
      is: 'group',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    description: Joi.string().max(200).optional(),
  }),

  post: Joi.object({
    content: Joi.string().max(2000).required(),
    images: Joi.array().items(Joi.string()).optional(),
  }),

  comment: Joi.object({
    content: Joi.string().max(500).required(),
  }),
};

// Validation middleware factory
export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body);
    
    if (error) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: ERROR_MESSAGES.VALIDATION_ERROR,
        errors: error.details.map((detail: any) => ({
          field: detail.path.join('.'),
          message: detail.message,
        })),
      });
      return;
    }
    
    next();
  };
};



export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});