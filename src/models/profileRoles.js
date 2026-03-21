module.exports = (sequelize, DataTypes) => {
  const ProfileRole = sequelize.define(
    "ProfileRole",
    {
      role_id: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false },
      profile_id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
    },
    {
      tableName: "profile_roles",
      schema: "linkedin",
      timestamps: false,
    }
  );

  return ProfileRole;
};
