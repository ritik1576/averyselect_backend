const code = `
public class Solution {
    public static int sumArray(int[] nums) {
        int sum = 0;

        for (int num : nums) {
            sum += num;
        }

        return sum;
    }
}
`;
const sanitizedCode = code.replace(
    /\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z0-9_]+)/g,
    'class $1'
);
console.log(sanitizedCode.includes("public class"));
