module.exports = (sequelize, DataTypes) => {
  const ProfileSkill = sequelize.define("ProfileSkill", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    skill_id: {
      type: DataTypes.BIGINT,
      allowNull: true, // null until normalize.sql backfills it
    },
    profile_id: DataTypes.BIGINT,
    // denormalized skill fields — stored during ingestion, normalized later
    skill_name: DataTypes.TEXT,
    is_inferred: DataTypes.BOOLEAN,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  }, {
    tableName: "profile_skills",
    schema: "linkedin",
    timestamps: true
  });

  return ProfileSkill;
};
