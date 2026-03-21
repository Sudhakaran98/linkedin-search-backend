module.exports = (sequelize, DataTypes) => {
  const ProfileBackup = sequelize.define(
    "ProfileBackup",
    {
      profile: {
        type: DataTypes.JSONB,
      }
    },
    {
      tableName: "profile_backup",
      schema: "linkedin",
      timestamps: false,
    }
  );

  return ProfileBackup;
};