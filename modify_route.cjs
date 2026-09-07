const fs = require('fs');
const path = 'src/modules/session/session.route.ts';
let ctrl = fs.readFileSync(path, 'utf8');

ctrl = ctrl.replace(
`router.patch('/:sessionId/score', sessionController.updateQuestionScore);`,
`router.patch('/:sessionId/score', sessionController.updateQuestionScore);
router.patch('/:sessionId/review', sessionController.updateReviewStatus);`
);

fs.writeFileSync(path, ctrl);
