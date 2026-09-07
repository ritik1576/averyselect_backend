import { userRepository } from './user.repository.js';
import bcrypt from 'bcrypt';

export class UserService {
  async getAllUsers() {
    return await userRepository.findAll();
  }

  async getUserById(id: string) {
    return await userRepository.findById(id);
  }

  async createUser(data: { name: string; email: string; passwordHash: string; companyId: string }) {
    // 1. Hash the password before saving it
    const hashedPassword = await bcrypt.hash(data.passwordHash, 10);
    
    // 2. Pass it to the repository
    return await userRepository.create({
      ...data,
      passwordHash: hashedPassword,
    });
  }

  async updateUser(id: string, data: { name?: string; password?: string }) {
    const updateData: { name?: string; password?: string } = {};
    if (data.name) updateData.name = data.name;
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }
    return await userRepository.update(id, updateData);
  }
}

export const userService = new UserService();
