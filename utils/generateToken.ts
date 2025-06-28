import jwt from 'jsonwebtoken';
import { config } from '../utils/constant';
import { JWTPayload } from '../types';

export const generateToken = (payload: { userId: string; email: string }): string => {
  return jwt.sign(payload, config.JWT_SECRET as string, {
    expiresIn: "24h",
  });
};

export const verifyToken = (token: string): JWTPayload => {
  return jwt.verify(token, config.JWT_SECRET) as JWTPayload;
};

export const generateRefreshToken = (payload: { userId: string; email: string }): string => {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: '30d', 
  });
};

export const decodeToken = (token: string): JWTPayload | null => {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch (error) {
    return null;
  }
};