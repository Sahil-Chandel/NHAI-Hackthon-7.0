import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionStore extends ChangeNotifier {
  static final SessionStore _instance = SessionStore._();
  factory SessionStore() => _instance;
  SessionStore._();

  final _storage = const FlutterSecureStorage();

  String? _token;
  String? _role;
  int? _expiresIn;
  Map<String, dynamic>? _userInfo;

  String? get token => _token;
  String? get role => _role;
  Map<String, dynamic>? get userInfo => _userInfo;
  bool get isLoggedIn => _token != null;
  bool get isAdmin => _role == 'admin';
  bool get isWorker => _role == 'worker';

  Future<void> init() async {
    _token = await _storage.read(key: 'auth_token');
    _role = await _storage.read(key: 'auth_role');
    notifyListeners();
  }

  Future<void> loginAsAdmin(String token, int expiresIn, Map<String, dynamic> admin) async {
    _token = token;
    _role = 'admin';
    _expiresIn = expiresIn;
    _userInfo = admin;
    await _storage.write(key: 'auth_token', value: token);
    await _storage.write(key: 'auth_role', value: 'admin');
    notifyListeners();
  }

  Future<void> loginAsWorker(String token, int expiresIn, Map<String, dynamic> worker) async {
    _token = token;
    _role = 'worker';
    _expiresIn = expiresIn;
    _userInfo = worker;
    await _storage.write(key: 'auth_token', value: token);
    await _storage.write(key: 'auth_role', value: 'worker');
    notifyListeners();
  }

  Future<void> logout() async {
    _token = null;
    _role = null;
    _expiresIn = null;
    _userInfo = null;
    await _storage.deleteAll();
    notifyListeners();
  }
}
