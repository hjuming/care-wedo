from datetime import datetime
from app import db

class User(db.Model):
    """用戶模型"""
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    line_user_id = db.Column(db.String(64), unique=True, index=True)
    name = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    appointments = db.relationship('Appointment', backref='user', lazy='dynamic')
    medications = db.relationship('Medication', backref='user', lazy='dynamic')

class FamilyGroup(db.Model):
    """家庭群組模型"""
    __tablename__ = 'family_groups'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64))
    invite_code = db.Column(db.String(10), unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

user_family_groups = db.Table('user_family_groups',
    db.Column('user_id', db.Integer, db.ForeignKey('users.id'), primary_key=True),
    db.Column('group_id', db.Integer, db.ForeignKey('family_groups.id'), primary_key=True),
    db.Column('role', db.String(20), default='member') # admin/member
)

class Appointment(db.Model):
    """預約模型"""
    __tablename__ = 'appointments'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    date = db.Column(db.String(20))
    time = db.Column(db.String(20))
    hospital = db.Column(db.String(128))
    department = db.Column(db.String(64))
    doctor = db.Column(db.String(64))
    number = db.Column(db.String(20))
    location = db.Column(db.String(256))
    fasting_required = db.Column(db.Boolean, default=False)
    fasting_hours = db.Column(db.Integer)
    notes = db.Column(db.Text)
    reminder_text = db.Column(db.Text)
    status = db.Column(db.String(20), default='upcoming') # upcoming/completed/cancelled
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Medication(db.Model):
    """用藥模型"""
    __tablename__ = 'medications'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    name = db.Column(db.String(128))
    dosage = db.Column(db.String(64))
    frequency = db.Column(db.String(64))
    purpose = db.Column(db.String(256))
    warnings = db.Column(db.Text)
    reminder_text = db.Column(db.Text)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
