import { prisma } from '../../lib/prisma.js';

export class UserRepository {
  async findAll() {
    return await prisma.user.findMany();
  }

  async findById(id: string) {
    return await prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string) {
    return await prisma.user.findUnique({
      where: { email },
    });
  }

  async create(data: { name: string; email: string; passwordHash: string; companyId: string }) {
    return await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: data.passwordHash,
        companyId: data.companyId,
      }
    });
  }

  async update(id: string, data: { name?: string; password?: string }) {
    return await prisma.user.update({
      where: { id },
      data,
    });
  }
}

export const userRepository = new UserRepository();
