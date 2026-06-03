import 'package:dio/dio.dart';
import '../models/attendance_event.dart';

class ApiClient {
  late final Dio _dio;
  String? _token;

  // Tunnel root (no /api/v1 suffix) — every endpoint path below includes the
  // full /api/v1/... prefix, matching the backend the Android app uses.
  ApiClient({String baseUrl = 'https://evidence-prefix-tool-syndrome.trycloudflare.com'}) {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_token != null) {
          options.headers['Authorization'] = 'Bearer $_token';
        }
        handler.next(options);
      },
    ));
  }

  Dio get dio => _dio;
  String? get token => _token;

  void setToken(String token) {
    _token = token;
  }

  void clearToken() {
    _token = null;
  }

  Future<String> authenticate(String deviceId, String sharedSecret) async {
    final response = await _dio.post('/auth/device', data: {
      'device_id': deviceId,
      'shared_secret': sharedSecret,
    });
    final token = response.data['token'] as String;
    _token = token;
    return token;
  }

  Future<Map<String, dynamic>> syncAttendanceBatch(
      List<AttendanceEvent> events) async {
    final response = await _dio.post('/attendance/batch', data: {
      'events': events.map((e) => e.toJson()).toList(),
    });
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> syncPunchEvents(
      List<Map<String, dynamic>> events) async {
    final response = await _dio.post('/punch-events/sync', data: {
      'events': events,
    });
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> queryAttendance(
      Map<String, dynamic> filters) async {
    final response = await _dio.get('/attendance', queryParameters: filters);
    return response.data as Map<String, dynamic>;
  }

  // ---------- Datalake 3.0 worker self-onboarding ----------

  /// Step 1: match First/Last/mobile/email against the Datalake registry.
  /// On success the backend returns a worker JWT + profile (worker.id == uuid).
  Future<Map<String, dynamic>> verifyWorker({
    required String firstName,
    required String lastName,
    required String mobile,
    required String email,
  }) async {
    final response = await _dio.post('/api/v1/worker/verify', data: {
      'first_name': firstName,
      'last_name': lastName,
      'mobile': mobile,
      'email': email,
    });
    return response.data as Map<String, dynamic>;
  }

  /// Step 2 (one-time): persist the enrolled face. Requires the worker token
  /// (set via [setToken] after verify). Backend dual-writes the embedding into
  /// the registry row and returns 409 if a face is already registered.
  Future<Map<String, dynamic>> registerFace({
    required String faceTemplateId,
    required List<double> embedding,
  }) async {
    final response = await _dio.post('/api/v1/worker/register-face', data: {
      'face_template_id': faceTemplateId,
      'embedding': embedding,
    });
    return response.data as Map<String, dynamic>;
  }
}
