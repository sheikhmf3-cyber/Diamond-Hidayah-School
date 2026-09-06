// school/class_name are free-text columns (no shared lookup table between
// cloud_students and cloud_teacher_classes), so teacher-assignment values and
// student-record values can drift by case or stray whitespace even when they
// mean the same class. Normalize before comparing so that drift doesn't
// silently exclude a student from a teacher's allowed classes.
function normalizeClassField(v) {
  return String(v || '').trim().toLowerCase();
}

function classesMatch(school, className, otherSchool, otherClassName) {
  return normalizeClassField(school) === normalizeClassField(otherSchool)
    && normalizeClassField(className) === normalizeClassField(otherClassName);
}

function isClassAllowed(userClasses, school, className) {
  return (userClasses || []).some(c => classesMatch(c.school, c.class_name, school, className));
}

module.exports = { normalizeClassField, classesMatch, isClassAllowed };
