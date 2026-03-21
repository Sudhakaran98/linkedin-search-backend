module.exports = (sequelize, DataTypes) => {
  const Skill = sequelize.define("Skill", {
    id: { type: DataTypes.BIGINT, primaryKey:true, autoIncrement:true },
    skill_name: DataTypes.TEXT,
    is_inferred: DataTypes.BOOLEAN,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE
  },{
    tableName:"skills",
    schema:"linkedin",
    timestamps:true
  });

  return Skill;
};