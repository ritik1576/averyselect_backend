with open('src/modules/grading/grading.service.ts', 'r') as f:
    c = f.read()
c = c.replace(
    r"const pyMatch = code.match(/def\\s+([a-zA-Z0-9_]+)\\s*\\(/);",
    r"const pyMatch = code.match(/def\s+([a-zA-Z0-9_]+)\s*\(/);"
)
c = c.replace(
    r"const jsMatch = code.match(/(?:function\\s+([a-zA-Z0-9_]+)\\s*\\()|(?:(?:const|let|var)\\s+([a-zA-Z0-9_]+)\\s*=\\s*(?:function|\\(.*=>|.*=>))/);",
    r"const jsMatch = code.match(/(?:function\s+([a-zA-Z0-9_]+)\s*\()|(?:(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\(.*=>|.*=>))/);"
)
with open('src/modules/grading/grading.service.ts', 'w') as f:
    f.write(c)
