module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define(
    "Role",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      role: DataTypes.TEXT,
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    {
      tableName: "roles",
      schema: "linkedin",
      timestamps: true,
    }
  );

  return Role;
};
