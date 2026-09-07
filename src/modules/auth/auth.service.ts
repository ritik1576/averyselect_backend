import { userRepository } from '../user/user.repository.js';
import { companyRepository } from '../company/company.repository.js';
import { AppError } from '../../utils/AppError.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export class AuthService {
  // Login standard implementation
  async login(email: string, passwordPlain: string) {
    // 1. Find the user
    const user = await userRepository.findByEmail(email);
    if (!user) {
      // Security best practice: Don't specify whether it was the email or password that was wrong
      throw new AppError('Invalid credentials', 401);
    }

    // 2. Compare passwords
    const isPasswordValid = await bcrypt.compare(passwordPlain, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // 3. Generate a JWT containing the userId and their companyId (tenant info)
    const tokenPayload = {
      userId: user.id,
      companyId: user.companyId,
    };

    const token = jwt.sign(tokenPayload, env.JWT_SECRET, {
      expiresIn: '24h', // Standard expiration
    });

    // 4. Return user info (excluding password) and the token
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        companyId: user.companyId,
      },
    };
  }
  // Signup: Creates a company and an admin user in one transaction
  async signup(companyName: string, userName: string, email: string, passwordPlain: string) {
    // 1. Check if the company already exists
    const existingCompany = await companyRepository.findByName(companyName);
    if (existingCompany) {
      throw new AppError('Company name already taken', 400);
    }

    // 2. Check if the user email already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      throw new AppError('Email already registered', 400);
    }

    // 3. Hash the password
    const hashedPassword = await bcrypt.hash(passwordPlain, 10);

    // 4. Use the nested write (Transaction) to create both
    const company = await companyRepository.createWithAdmin(companyName, {
      name: userName,
      email: email,
      password: hashedPassword,
    });

    const createdUser = company.users[0];

    // 5. Generate a JWT so they are logged in immediately
    const tokenPayload = {
      userId: createdUser.id,
      companyId: company.id,
    };

    const token = jwt.sign(tokenPayload, env.JWT_SECRET, {
      expiresIn: '24h',
    });

    return {
      token,
      company: { id: company.id, name: company.name },
      user: {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
      },
    };
  }
}

export const authService = new AuthService();
