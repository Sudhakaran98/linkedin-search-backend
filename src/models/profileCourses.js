module.exports = (sequelize, DataTypes) => {
  const Course = sequelize.define("Course", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    profile_id: DataTypes.BIGINT,
    organizer: DataTypes.TEXT,
    title: DataTypes.TEXT,
    order_in_profile: DataTypes.INTEGER,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  }, {
    tableName: "profile_courses",
    schema: "linkedin",
    timestamps: true
  });

  return Course;
};