import os

file_path = "src/modules/grading/grading.service.ts"
with open(file_path, "r") as f:
    content = f.read()

old_code = """  async gradeSession(sessionId: string) {"""

new_code = """  // Simple in-memory queue to prevent Judge0 rate limit exhaustion
  private static gradingQueue: string[] = [];
  private static isGrading = false;

  async gradeSession(sessionId: string) {
    GradingService.gradingQueue.push(sessionId);
    this.processQueue();
  }

  private async processQueue() {
    if (GradingService.isGrading || GradingService.gradingQueue.length === 0) return;
    GradingService.isGrading = true;

    while (GradingService.gradingQueue.length > 0) {
      const sessionId = GradingService.gradingQueue.shift();
      if (sessionId) {
        try {
          await this.executeGrading(sessionId);
        } catch (e) {
          console.error(`Error grading session ${sessionId}:`, e);
        }
        // Add a 2-second cooldown between grading candidates to let Judge0 breathe
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    GradingService.isGrading = false;
  }

  async executeGrading(sessionId: string) {"""

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(file_path, "w") as f:
        f.write(content)
    print("Replaced successfully!")
else:
    print("Code snippet not found!")
